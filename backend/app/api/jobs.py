"""Render jobs API.

POST /api/render/batch
  body:
    {
      "name": "...",
      "assignments": [
        { "template_id": int, "fills": { "<placeholder_clip_id>": "<token>" } },
        ...
      ],
      "metadata_profile": { ... }
    }
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.db import get_db
from app.db.models import JobStatus, RenderJob, Template

router = APIRouter(prefix="/api", tags=["jobs"])

MAX_RENDERS_PER_BATCH = 50


class Assignment(BaseModel):
    template_id: int
    fills: dict[str, str] = Field(default_factory=dict)


class MetadataProfile(BaseModel):
    enabled: bool = False
    method: str = "QuickTime branding + binary patch + randomized metadata"
    model: Optional[str] = "iPhone 17 Pro"
    country: Optional[str] = "USA"
    language: Optional[str] = "en-US"
    date_window_days: int = Field(default=7, ge=1, le=30)


class RenderBatchRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    assignments: list[Assignment] = Field(min_length=1)
    metadata_profile: MetadataProfile = Field(default_factory=MetadataProfile)


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: JobStatus
    assignments: list
    metadata_profile: dict
    output_zip_path: Optional[str]
    output_files: list
    progress: int
    error: Optional[str]
    created_at: datetime
    finished_at: Optional[datetime]


class JobSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: JobStatus
    progress: int
    created_at: datetime
    finished_at: Optional[datetime]
    output_count: int
    has_zip: bool


class DashboardStats(BaseModel):
    template_count: int
    render_count: int


@router.post(
    "/render/batch",
    response_model=JobRead,
    status_code=status.HTTP_201_CREATED,
)
def create_batch(
    payload: RenderBatchRequest, db: Session = Depends(get_db)
) -> RenderJob:
    if len(payload.assignments) > MAX_RENDERS_PER_BATCH:
        raise HTTPException(
            400, f"Max {MAX_RENDERS_PER_BATCH} renders per batch"
        )

    template_ids = {a.template_id for a in payload.assignments}
    found = {
        t.id for t in db.query(Template).filter(Template.id.in_(template_ids)).all()
    }
    missing = template_ids - found
    if missing:
        raise HTTPException(400, f"Unknown template_ids={sorted(missing)}")

    job = RenderJob(
        name=payload.name,
        status=JobStatus.queued,
        assignments=[a.model_dump() for a in payload.assignments],
        metadata_profile=payload.metadata_profile.model_dump(),
        progress=0,
        output_files=[],
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    celery_app.send_task("process_render_job", args=[job.id])
    return job


@router.get("/jobs", response_model=list[JobSummary])
def list_jobs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[JobSummary]:
    rows = (
        db.query(RenderJob)
        .order_by(RenderJob.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        JobSummary(
            id=j.id,
            name=j.name,
            status=j.status,
            progress=j.progress,
            created_at=j.created_at,
            finished_at=j.finished_at,
            output_count=len(j.output_files or []),
            has_zip=bool(j.output_zip_path),
        )
        for j in rows
    ]


@router.get("/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: int, db: Session = Depends(get_db)) -> RenderJob:
    job = db.get(RenderJob, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/dashboard/stats", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    return DashboardStats(
        template_count=db.query(Template).count(),
        render_count=db.query(RenderJob).count(),
    )
