"""Phase 38 — Spoof-only batch endpoint.

Allows users to upload videos and apply the QuickTime metadata
spoofing pipeline WITHOUT going through the full render (clips +
templates + ffmpeg encoding). Cheaper because we just copy the
upload to the output dir and run the metadata pass on it.

Cost : 0.5 credit per video (vs 1 credit for a full render).

POST /api/spoof/batch
  body :
    {
      "name": "...",
      "tokens": ["<upload-token>", ...],
      "metadata_profile": { enabled: true, model, country, ... },
      "naming": "default" | "iphone",
      "pass_label": "Generation"
    }

Returns the same JobRead as the render batch endpoint — the spoof
jobs are surfaced in /jobs with a `kind: "spoof"` flag for UI
distinction.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.jobs import JobRead, MetadataProfile, MAX_RENDERS_PER_BATCH
from app.db import get_db
from app.db.models import RenderJob, JobStatus, User
from app.users import require_user
from app.worker import queue_render_job

router = APIRouter(prefix="/api/spoof", tags=["spoof"])

# Spoof-only cost. 0.5 credit per video so 1 credit = 2 spoofed videos.
SPOOF_COST_PER_VIDEO = 0.5


class SpoofBatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=200)
    # List of upload tokens (returned by POST /api/render/upload).
    tokens: list[str] = Field(min_length=1)
    metadata_profile: MetadataProfile = Field(default_factory=MetadataProfile)
    naming: str = "default"        # "default" | "iphone"
    pass_label: str = "Generation"


@router.post("/batch", response_model=JobRead)
def create_spoof_batch(
    payload: SpoofBatchRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> RenderJob:
    n = len(payload.tokens)
    if n > MAX_RENDERS_PER_BATCH:
        raise HTTPException(
            400,
            f"Max {MAX_RENDERS_PER_BATCH} vidéos par batch — "
            f"tu en as envoyé {n}.",
        )

    # Force the spoof to be ON. The whole point of this endpoint is
    # the spoof — if the user didn't enable it explicitly in the UI
    # we still apply the metadata pass (cheaper to ignore than to
    # refuse). Caller can set metadata_profile.enabled=true explicitly
    # to be sure ; we override below regardless.
    metadata_profile = payload.metadata_profile.model_dump()
    metadata_profile["enabled"] = True
    metadata_profile["naming"] = payload.naming
    metadata_profile["pass_label"] = payload.pass_label

    # 0.5 credit × N videos. We allow fractional balances thanks to the
    # Float column (Phase 38). Reject if insufficient — same UX as
    # the render batch endpoint.
    cost = SPOOF_COST_PER_VIDEO * n
    if user.render_credits < cost:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Crédits insuffisants : il te faut {cost:g} crédits "
                f"({n} vidéos × 0.5), tu en as {user.render_credits:g}. "
                f"Demande à l'admin d'en ajouter."
            ),
        )

    # Build one assignment per video : { token, gen_idx=1 }. The render
    # worker (tasks/render.py) detects job.kind == "spoof" and skips
    # the full ffmpeg pipeline, just copying the upload and running
    # apply_quicktime_metadata on it.
    assignments = [
        {"token": tok, "gen_idx": 1, "_gen": 1}
        for tok in payload.tokens
    ]

    job = RenderJob(
        owner_id=user.id,
        name=payload.name,
        kind="spoof",
        status=JobStatus.queued,
        assignments=assignments,
        metadata_profile=metadata_profile,
    )
    db.add(job)
    # Debit credits up-front. Refunded per-failure in process_render_job
    # (Phase 36 logic, kept identical so a video that ffmpeg rejects
    # isn't billed).
    user.render_credits = user.render_credits - cost
    db.commit()
    db.refresh(job)

    queue_render_job(job.id, priority=user.priority.value)
    return job
