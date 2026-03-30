"""add_memory_table

Revision ID: auto_generated
Revises: d8dc8ea173ed
Create Date: 2026-03-28

"""
from alembic import op
import sqlalchemy as sa


revision = 'auto_generated_memory'
down_revision = 'd8dc8ea173ed'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """升级数据库 - 创建记忆表"""
    # 创建记忆表
    op.create_table(
        'memories',
        sa.Column('id', sa.String(26), nullable=False),
        sa.Column('session_id', sa.String(26), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('memory_type', sa.String(50), nullable=False, default='general'),
        sa.Column('importance', sa.Integer(), default=5),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('metadata_', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ['session_id'], 
            ['session.id'], 
            ondelete='CASCADE', 
            name='fk_memory_session_id'
        ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # 创建索引
    op.create_index('idx_memory_session_id', 'memories', ['session_id'])
    op.create_index('idx_memory_type', 'memories', ['memory_type'])
    op.create_index('idx_memory_importance', 'memories', ['importance'])
    op.create_index(
        'idx_memory_session_type', 
        'memories', 
        ['session_id', 'memory_type']
    )


def downgrade() -> None:
    """回滚迁移 - 删除记忆表"""
    op.drop_index('idx_memory_session_type', table_name='memories')
    op.drop_index('idx_memory_importance', table_name='memories')
    op.drop_index('idx_memory_type', table_name='memories')
    op.drop_index('idx_memory_session_id', table_name='memories')
    op.drop_table('memories')
