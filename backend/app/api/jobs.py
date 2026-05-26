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

from app.db import get_db
from app.db.models import JobStatus, RenderJob, Template, User
from app.users import require_user
from app.worker import queue_render_job

router = APIRouter(prefix="/api", tags=["jobs"])

MAX_RENDERS_PER_BATCH = 500


class Assignment(BaseModel):
    template_id: int
    fills: dict[str, str] = Field(default_factory=dict)
    # Phase 29c — optional pass/group index sent by the frontend when it
    # has already pre-rolled multi-pass assignments (e.g. random reroll
    # mode where each pass shuffles vidéo→template differently). The
    # backend respects this if set, otherwise it auto-assigns based on
    # the `generations` multiplier below.
    gen_idx: Optional[int] = None


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
    # Phase 29 — multiplie chaque assignment N fois. Chaque pass produit
    # le même reel mais avec un tirage de métadonnées indépendant.
    # Ignoré si les assignments arrivent déjà pré-multipassed (= ils
    # portent leur propre `gen_idx`, cas du random reroll côté wizard).
    generations: int = Field(default=1, ge=1, le=10)
    # Phase 29 — naming style des MP4 dans le ZIP final.
    # "iphone" → IMG_xxxx.mp4, "default" → {slug(template)}_{i}.mp4
    naming: str = Field(default="iphone")
    # Phase 29c — label pour les sous-dossiers de groupement dans le ZIP.
    # "Generation" par défaut (cas generations multiplier). En mode random
    # reroll, le frontend envoie "Tirage" pour avoir des `Tirage 1/`,
    # `Tirage 2/` etc plus clairs sémantiquement.
    pass_label: str = Field(default="Generation")


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: JobStatus
    assignments: list
    metadata_profile: dict
    output_zip_path: Optional[str]
    output_files: list
    # Phase 36 — per-item failures (empty when no failure).
    failed_assignments: list = []
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
    # Phase 36 — how many assignments failed (0 when none).
    failed_count: int = 0


class DashboardStats(BaseModel):
    template_count: int
    render_count: int


@router.post(
    "/render/batch",
    response_model=JobRead,
    status_code=status.HTTP_201_CREATED,
)
def create_batch(
    payload: RenderBatchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> RenderJob:
    # Phase 29 — multi-pass assignments. Deux sources possibles :
    #   1. Le frontend a déjà multi-passed (random reroll : 3 tirages
    #      avec mappings différents) → chaque assignment porte son
    #      propre `gen_idx`, on les garde tels quels.
    #   2. Le frontend envoie N assignments + `generations=K` → on les
    #      multiplie K fois, chacun avec son `gen_idx` (legacy Phase 29a).
    base_assignments = [a.model_dump() for a in payload.assignments]
    frontend_already_multipassed = any(
        a.get("gen_idx") is not None for a in base_assignments
    )
    expanded_assignments: list[dict] = []
    if frontend_already_multipassed:
        # Trust frontend annotations. Fill missing gen_idx with 1.
        for a in base_assignments:
            entry = dict(a)
            if entry.get("gen_idx") is None:
                entry["gen_idx"] = 1
            # Store under both legacy `_gen` and new `gen_idx` keys for
            # downstream compat (render task reads `_gen`).
            entry["_gen"] = entry["gen_idx"]
            expanded_assignments.append(entry)
    else:
        # Legacy generations multiplier path.
        for gen_idx in range(payload.generations):
            for a in base_assignments:
                expanded_assignments.append(
                    {**a, "_gen": gen_idx + 1, "gen_idx": gen_idx + 1}
                )

    if len(expanded_assignments) > MAX_RENDERS_PER_BATCH:
        raise HTTPException(
            400,
            f"Max {MAX_RENDERS_PER_BATCH} renders per batch — "
            f"tu as {len(expanded_assignments)} reels demandés.",
        )

    # Templates must exist AND be owned by the requesting user.
    template_ids = {a.template_id for a in payload.assignments}
    owned = {
        t.id
        for t in db.query(Template)
        .filter(Template.id.in_(template_ids), Template.owner_id == user.id)
        .all()
    }
    missing = template_ids - owned
    if missing:
        raise HTTPException(
            400,
            f"Templates inconnus ou pas les tiens : {sorted(missing)}",
        )

    # Phase 33 — per-user render credits. 1 credit = 1 reel.
    # Admin has effectively unlimited credits (10^9 at bootstrap).
    cost = len(expanded_assignments)
    if user.render_credits < cost:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Crédits insuffisants : il te faut {cost} crédits "
                f"({cost} reels à produire), tu en as {user.render_credits}. "
                f"Demande à l'admin d'en ajouter."
            ),
        )

    # Stash naming style + pass label alongside the metadata profile so
    # the render task can read them without changing its function sig.
    metadata_profile = payload.metadata_profile.model_dump()
    metadata_profile["naming"] = payload.naming
    metadata_profile["pass_label"] = payload.pass_label

    job = RenderJob(
        owner_id=user.id,
        name=payload.name,
        status=JobStatus.queued,
        assignments=expanded_assignments,
        metadata_profile=metadata_profile,
        progress=0,
        output_files=[],
    )
    db.add(job)
    # Decrement credits in the same transaction so a parallel batch
    # can't double-spend.
    user.render_credits -= cost
    db.commit()
    db.refresh(job)

    # Worker prioritises high < normal < low. We pass the user.priority
    # so it ends up in the right queue.
    queue_render_job(job.id, priority=user.priority.value)
    return job


@router.get("/jobs", response_model=list[JobSummary])
def list_jobs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> list[JobSummary]:
    rows = (
        db.query(RenderJob)
        .filter(RenderJob.owner_id == user.id)
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
            failed_count=len(j.failed_assignments or []),
        )
        for j in rows
    ]


@router.get("/jobs/{job_id}", response_model=JobRead)
def get_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> RenderJob:
    job = db.get(RenderJob, job_id)
    if job is None or job.owner_id != user.id:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/dashboard/stats", response_model=DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> DashboardStats:
    return DashboardStats(
        template_count=db.query(Template)
        .filter(Template.owner_id == user.id).count(),
        render_count=db.query(RenderJob)
        .filter(RenderJob.owner_id == user.id).count(),
    )
