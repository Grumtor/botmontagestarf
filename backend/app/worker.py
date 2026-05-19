"""In-process render worker with priority queue (Phase 33).

Replaces the previous flat ThreadPoolExecutor. Each user has a priority
(high / normal / low) and jobs are pulled from a shared `PriorityQueue`
so admins always jump the line over regular users.

Concurrency is `settings.render_workers` (default 1). Threads work
fine here because the heavy work is `subprocess.run(["ffmpeg", …])`
which releases the GIL.
"""

from __future__ import annotations

import logging
import queue
import threading
from itertools import count
from typing import Optional

from app.config import settings

log = logging.getLogger(__name__)

# (priority_int, sequence, job_id) tuples. Lower priority_int = served first.
# `sequence` is a monotonic counter that breaks ties FIFO within the same
# priority level (so two "normal" jobs are processed in submission order).
_queue: Optional["queue.PriorityQueue[tuple[int, int, int]]"] = None
_threads: list[threading.Thread] = []
_stop_flag = threading.Event()
_seq = count()

# Mapping user.priority.value → priority_int for the queue. Lower = sooner.
PRIORITY_MAP = {
    "high": 0,
    "normal": 1,
    "low": 2,
}


def _worker_loop(idx: int) -> None:
    """Worker thread main loop. Pulls jobs from the priority queue and
    runs them. Exits when _stop_flag is set."""
    # Imported lazily to avoid a circular import at module load.
    from app.tasks.render import process_render_job

    log.info("render worker %d started", idx)
    while not _stop_flag.is_set():
        try:
            # 1s timeout so we can exit on stop_flag instead of blocking
            # forever on an empty queue.
            assert _queue is not None
            prio, _seq_n, job_id = _queue.get(timeout=1.0)
        except queue.Empty:
            continue

        log.info(
            "worker %d picking job_id=%s (priority=%d)", idx, job_id, prio
        )
        try:
            process_render_job(job_id)
        except Exception as e:
            log.exception("worker %d crashed on job %s: %s", idx, job_id, e)
        finally:
            _queue.task_done()
    log.info("render worker %d exiting", idx)


def start_worker() -> None:
    global _queue
    if _queue is not None:
        return
    _queue = queue.PriorityQueue()
    _stop_flag.clear()
    n = max(1, settings.render_workers)
    for i in range(n):
        t = threading.Thread(
            target=_worker_loop,
            args=(i,),
            name=f"render-worker-{i}",
            daemon=True,
        )
        t.start()
        _threads.append(t)
    log.info("Render worker started with %d thread(s)", n)


def stop_worker() -> None:
    global _queue
    _stop_flag.set()
    for t in _threads:
        t.join(timeout=2.0)
    _threads.clear()
    _queue = None


def queue_render_job(job_id: int, priority: str = "normal") -> None:
    """Enqueue a render job with the given priority. `priority` is one
    of "high", "normal", "low" (matches UserPriority enum values).
    Unknown values default to "normal"."""
    if _queue is None:
        start_worker()
    assert _queue is not None
    prio_int = PRIORITY_MAP.get(priority, PRIORITY_MAP["normal"])
    _queue.put((prio_int, next(_seq), job_id))
