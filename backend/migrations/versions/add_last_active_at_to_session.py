"""add_last_active_at_to_session

Revision ID: add_last_active_at_to_session
Revises: add_character_id_to_session
Create Date: 2026-03-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from alembic.operations.ops import UpgradeOps, ModifyTableOps, AddColumnOp
import datetime


# revision identifiers, used by Alembic.
revision: str = 'add_last_active_at_to_session'
down_revision: Union[str, None] = '3daf0aa18f73'  # 基于最新的 head
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite 需要使用 batch mode 来修改表结构
    with op.batch_alter_table('session', schema=None) as batch_op:
        # 添加 last_active_at 列
        batch_op.add_column(sa.Column('last_active_at', sa.DateTime(), nullable=True))
        
        # 创建索引以优化排序性能
        batch_op.create_index(batch_op.f('ix_session_last_active_at'), ['last_active_at'], unique=False)
    
    # 重要：为现有数据初始化 last_active_at 字段（使用 updated_at 的值）
    # 由于 Alembic 的 batch mode 限制，我们需要在 Python 层面执行更新
    # 这部分逻辑将在 migration.py 中处理，或者手动执行 SQL
    
    # 对于 SQLite，我们可以直接使用 SQL 更新
    conn = op.get_bind()
    conn.execute(
        sa.text("""
            UPDATE session 
            SET last_active_at = updated_at 
            WHERE last_active_at IS NULL AND updated_at IS NOT NULL
        """)
    )


def downgrade() -> None:
    with op.batch_alter_table('session', schema=None) as batch_op:
        # 删除索引
        batch_op.drop_index(batch_op.f('ix_session_last_active_at'))
        
        # 删除列
        batch_op.drop_column('session', 'last_active_at')
