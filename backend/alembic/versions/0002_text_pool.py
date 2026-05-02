"""text pool

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-02 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "text_pools",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "template_id",
            sa.Integer(),
            sa.ForeignKey("templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("layer_id", sa.String(), nullable=False),
        sa.Column(
            "items",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "template_id", "layer_id", name="uq_text_pools_template_layer"
        ),
    )
    op.create_index("ix_text_pools_template_id", "text_pools", ["template_id"])


def downgrade() -> None:
    op.drop_index("ix_text_pools_template_id", table_name="text_pools")
    op.drop_table("text_pools")
