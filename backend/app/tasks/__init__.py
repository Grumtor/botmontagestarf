from app.celery_app import celery_app
from app.tasks.render import process_render_job  # noqa: F401  — register task


@celery_app.task(name="ping")
def ping() -> str:
    return "pong"
