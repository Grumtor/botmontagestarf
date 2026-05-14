"""In-process render worker.

Replaces Celery + Redis for the local-only setup. A `ThreadPoolExecutor`
runs render jobs in background threads of the same process as the FastAPI
server. Submitting a job is just `queue_render_job(job_id)`.

Threads work fine here because the heavy work is `subprocess.run(["ffmpeg", …])`
which releases the GIL completely. Concurrency is configurable via
`settings.render_workers` (default 1 — bumping it past 1 mostly hurts on
laptops because each ffmpeg already saturates CPU/disk).
"""

from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Optional

from app.config import settings

log = logging.getLogger(__name__)

_executor: Optional[ThreadPoolExecutor] = None


def start_worker() -> None:
    global _executor
    if _executor is not None:
        return
    _executor = ThreadPoolExecutor(
        max_workers=max(1, settings.render_workers),
        thread_name_prefix="render-worker",
    )
    log.info("Render worker started with %d thread(s)", settings.render_workers)


def stop_worker() -> None:
    global _executor
    if _executor is None:
        return
    _executor.shutdown(wait=False, cancel_futures=False)
    _executor = None


def queue_render_job(job_id: int) -> Future:
    """Schedule a render job to run in a background thread. Returns the
    Future so callers can await it in tests; production callers typically
    fire-and-forget."""
    if _executor is None:
        start_worker()
    assert _executor is not None
    # Imported lazily to avoid a circular import at module load.
    from app.tasks.render import process_render_job

    return _executor.submit(process_render_job, job_id)
