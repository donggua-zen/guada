"""add_character_id_to_session

Revision ID: add_character_id_to_session
Revises: d8dc8ea173ed
Create Date: 2026-03-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from alembic.operations.ops import UpgradeOps, ModifyTableOps, AddColumnOp


# revision identifiers, used by Alembic.
revision: str = 'add_character_id_to_session'
down_revision: Union[str, None] = 'd8dc8ea173ed'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite 需要使用 batch mode 来修改表结构
    with op.batch_alter_table('session', schema=None) as batch_op:
        # 添加 character_id 列
        batch_op.add_column(sa.Column('character_id', sa.String(26), nullable=True))
        
        # 创建索引
        batch_op.create_index(batch_op.f('ix_session_character_id'), ['character_id'], unique=False)
    
    # 对于 SQLite，外键约束在模型层面处理，不在数据库层面强制
    # 如果需要显式添加外键，需要在 SQLite 中重新创建表
    # 这里我们依赖 SQLAlchemy ORM 层面的外键验证


def downgrade() -> None:
    with op.batch_alter_table('session', schema=None) as batch_op:
        # 删除索引
        batch_op.drop_index(batch_op.f('ix_session_character_id'))
        
        # 删除列
        batch_op.drop_column('session', 'character_id')
