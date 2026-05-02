from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.celery_app import celery_app
from app.db import get_db
from app.db.models import JobStatus, RenderJob, Template, VideoSource

router = APIRouter(prefix="/api", tags=["jobs"])

MAX_RENDERS_PER_BATCH = 50


# ---- schemas ----------------------------------------------------------

class Assignment(BaseModel):
    source_id: int
    template_id: int


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
    source_count: int
    render_count: int


# ---- routes -----------------------------------------------------------

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
            status_code=400,
            detail=f"Max {MAX_RENDERS_PER_BATCH} renders per batch",
        )

    # Validate referenced templates and sources exist.
    template_ids = {a.template_id for a in payload.assignments}
    source_ids = {a.source_id for a in payload.assignments}
    found_templates = {
        t.id for t in db.query(Template).filter(Template.id.in_(template_ids)).all()
    }
    found_sources = {
        s.id for s in db.query(VideoSource).filter(VideoSource.id.in_(source_ids)).all()
    }
    missing_t = template_ids - found_templates
    missing_s = source_ids - found_sources
    if missing_t or missing_s:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown template_ids={sorted(missing_t)} source_ids={sorted(missing_s)}",
        )

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
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/dashboard/stats", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)) -> DashboardStats:
    return DashboardStats(
        template_count=db.query(Template).count(),
        source_count=db.query(VideoSource).count(),
        render_count=db.query(RenderJob).count(),
    )
