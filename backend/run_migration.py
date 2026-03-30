"""
数据库迁移脚本

用于执行 Alembic 迁移操作
"""

import sys
import os
from pathlib import Path

# 添加项目根目录到路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from alembic.config import Config
from alembic import command

def main():
    """运行数据库迁移"""
    # 获取当前脚本的绝对路径
    current_script_path = os.path.abspath(__file__)
    current_directory = os.path.dirname(current_script_path)
    os.chdir(current_directory)
    
    # 加载环境变量
    from dotenv import load_dotenv
    load_dotenv()
    
    # 创建 Alembic 配置
    alembic_cfg = Config('alembic.ini')
    
    print("🚀 Running database migration...")
    
    # 执行升级
    try:
        command.upgrade(alembic_cfg, 'head')
        print("✅ Database migration completed successfully!")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
