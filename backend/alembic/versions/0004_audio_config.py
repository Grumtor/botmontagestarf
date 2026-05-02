"""audio_source + audio_overlay columns on templates

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "templates",
        sa.Column(
            "audio_source",
            postgresql.JSONB(),
            server_default=sa.text("'{\"volume\": 1.0, \"enabled\": true}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "templates",
        sa.Column(
            "audio_overlay",
            postgresql.JSONB(),
            server_default=sa.text(
                "'{\"asset_id\": null, \"volume\": 1.0, \"start_offset\": 0, \"trim_in\": 0}'::jsonb"
            ),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("templates", "audio_overlay")
    op.drop_column("templates", "audio_source")
