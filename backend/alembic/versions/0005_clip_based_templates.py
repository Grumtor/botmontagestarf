"""Pivot to clip-based templates.

Drops the VideoSource and TextPool tables (no library concept anymore).
Drops template columns made obsolete by the new clip model.
Adds the `clips` JSONB array column to templates.
Resets `layers` to [] for existing templates (old layer types incompatible).

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-03 02:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop tables we no longer need.
    op.drop_index("ix_text_pools_template_id", table_name="text_pools")
    op.drop_table("text_pools")
    op.drop_table("video_sources")

    # Drop obsolete template columns.
    op.drop_column("templates", "duration_sec")
    op.drop_column("templates", "source_segments")
    op.drop_column("templates", "audio_source")

    # Add the new clips array.
    op.add_column(
        "templates",
        sa.Column(
            "clips",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )

    # Replace audio_overlay default to use the new file_id-based shape.
    op.alter_column(
        "templates",
        "audio_overlay",
        server_default=sa.text(
            "'{\"file_id\": null, \"volume\": 1.0, \"start_offset\": 0, \"trim_in\": 0}'::jsonb"
        ),
    )

    # Wipe existing layers and audio_overlay since the schemas changed.
    op.execute("UPDATE templates SET layers = '[]'::jsonb")
    op.execute(
        "UPDATE templates SET audio_overlay = "
        "'{\"file_id\": null, \"volume\": 1.0, \"start_offset\": 0, \"trim_in\": 0}'::jsonb"
    )


def downgrade() -> None:
    # We don't support downgrade past this pivot.
    raise NotImplementedError("0005 is a one-way pivot to clip-based templates")
