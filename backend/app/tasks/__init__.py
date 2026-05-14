# Render task is now a plain function used by app.worker. Nothing to
# register here, but the package import is still kept so callers can do
# `from app.tasks.render import process_render_job` cleanly.
