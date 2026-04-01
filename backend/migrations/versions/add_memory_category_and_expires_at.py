"""add_memory_category_and_expires_at

Revision ID: add_memory_category_expires
Revises: auto_generated_memory
Create Date: 2026-03-30

添加记忆分类字段和过期时间字段，支持长期/短期记忆分离架构
"""
from alembic import op
import sqlalchemy as sa


revision = 'add_memory_category_expires'
down_revision = 'auto_generated_memory'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """升级数据库 - 添加记忆分类和过期时间字段"""
    
    # SQLite 需要使用 batch mode
    from alembic import op
    import sqlalchemy as sa
    
    # 检查是否是 SQLite
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == 'sqlite'
    
    if is_sqlite:
        # SQLite 使用 batch operations
        with op.batch_alter_table('memories') as batch_op:
            # 1. 添加 category 字段
            batch_op.add_column(
                sa.Column(
                    'category',
                    sa.String(20),
                    nullable=False,
                    server_default='long_term'
                )
            )
            
            # 2. 添加 expires_at 字段
            batch_op.add_column(
                sa.Column(
                    'expires_at',
                    sa.DateTime(),
                    nullable=True
                )
            )
            
            # 3. 创建新索引
            batch_op.create_index('idx_memory_category', ['category'])
            batch_op.create_index('idx_memory_session_category', ['session_id', 'category'])
            batch_op.create_index('idx_memory_expires', ['expires_at'])
    else:
        # MySQL/PostgreSQL 直接使用普通模式
        # 1. 添加 category 字段
        op.add_column(
            'memories',
            sa.Column(
                'category',
                sa.String(20),
                nullable=False,
                server_default='long_term',
                comment='记忆分类：long_term/short_term'
            )
        )
        
        # 2. 添加 expires_at 字段
        op.add_column(
            'memories',
            sa.Column(
                'expires_at',
                sa.DateTime(),
                nullable=True,
                comment='过期时间（仅短期记忆使用）'
            )
        )
        
        # 3. 更新 memory_type 字段的注释
        op.alter_column(
            'memories',
            'memory_type',
            existing_type=sa.String(50),
            comment='记忆子类型：factual/soul(长期) 或 temporary/context(短期)'
        )
        
        # 4. 创建新索引
        op.create_index('idx_memory_category', 'memories', ['category'])
        op.create_index('idx_memory_session_category', 'memories', ['session_id', 'category'])
        op.create_index('idx_memory_expires', 'memories', ['expires_at'])
    
    # 5. 数据迁移：将现有记录标记为 long_term.factual
    op.execute(
        "UPDATE memories SET category = 'long_term' WHERE category IS NULL"
    )


def downgrade() -> None:
    """回滚迁移 - 删除新增的字段和索引"""
    
    # 1. 删除索引
    op.drop_index('idx_memory_expires', table_name='memories')
    op.drop_index('idx_memory_session_category', table_name='memories')
    op.drop_index('idx_memory_category', table_name='memories')
    
    # 2. 删除字段
    op.drop_column('memories', 'expires_at')
    op.drop_column('memories', 'category')
