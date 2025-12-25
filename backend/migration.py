import configparser
import os
import sys
import argparse
from dotenv import load_dotenv
from alembic.config import Config
from alembic import command


def main():
    parser = argparse.ArgumentParser(description="Database migration tool for FastAPI")
    parser.add_argument("--env-file", required=True, help="Path to .env file")
    parser.add_argument(
        "command", choices=["upgrade", "downgrade", "revision"], help="Alembic command"
    )
    parser.add_argument("--message", "-m", help="Migration message (for revision)")

    args = parser.parse_args()

    # 加载 .env 文件
    if not os.path.exists(args.env_file):
        print(f"Error: {args.env_file} not found!")
        sys.exit(1)
    load_dotenv(args.env_file)

    # 初始化 Alembic 配置
    alembic_cfg = Config(
        "alembic.ini",
        ini_section="alembic",
        # 关键：禁用 % 插值！
        file_config=configparser.ConfigParser(interpolation=None),
    )

    # 执行命令
    try:
        if args.command == "upgrade":
            command.upgrade(alembic_cfg, "head")
        elif args.command == "downgrade":
            command.downgrade(alembic_cfg, "-1")
        elif args.command == "revision":
            autogenerate = True  # 默认自动检测模型变更
            command.revision(
                alembic_cfg, message=args.message, autogenerate=autogenerate
            )
        print(f"✅ Successfully executed: {args.command}")
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
