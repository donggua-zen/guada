"""add file_metadata to file table

Revision ID: add_file_metadata
Revises: d8dc8ea173ed
Create Date: 2026-03-26 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_file_metadata'
down_revision = 'd8dc8ea173ed'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 添加 file_metadata 列（JSON 类型）
    op.add_column('file', sa.Column('file_metadata', sa.JSON(), nullable=True))


def downgrade() -> None:
    # 删除 file_metadata 列
    op.drop_column('file', 'file_metadata')
