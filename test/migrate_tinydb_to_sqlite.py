# migrate_tinydb_to_sqlite.py
import json
import os
import sqlite3
from pathlib import Path
from datetime import datetime
import sys
import ulid
from sqlalchemy.orm import Session

current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from models import SessionLocal, Character, Session as SessionModel, Message, Summary


def read_tinydb_json(file_path):
    """读取 TinyDB JSON 文件并正确处理其结构"""
    if not file_path.exists():
        return []

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # TinyDB 的 JSON 结构可能有两种格式：
    # 1. 直接是文档列表
    # 2. 包含 _default 键的对象，其中包含文档
    if isinstance(data, dict) and "_default" in data:
        # 这是 TinyDB 的标准存储格式
        return list(data["_default"].values())
    elif isinstance(data, list):
        # 直接是文档列表
        return data
    else:
        print(f"警告: 无法识别的 JSON 格式在 {file_path}")
        return []


def migrate_characters():
    """迁移字符数据"""
    print("开始迁移字符数据...")

    # 读取 TinyDB 字符数据
    characters_data = read_tinydb_json(Path("./data/ai_characters.json"))

    if not characters_data:
        print("未找到字符数据，跳过迁移")
        return

    db_session = SessionLocal()
    migrated_count = 0

    try:
        for char_data in characters_data:
            # 确保 char_data 是字典，不是字符串
            if not isinstance(char_data, dict):
                print(f"跳过非字典类型的字符数据: {char_data}")
                continue

            # 复制数据以避免修改原始字典
            char_data_copy = char_data.copy()

            # 处理 ID
            if "_id" in char_data_copy:
                char_id = char_data_copy.pop("_id")
            elif "id" in char_data_copy:
                char_id = char_data_copy["id"]
            else:
                char_id = str(ulid.new())
                char_data_copy["id"] = char_id

            # 提取固定字段
            name = char_data_copy.pop("name", "")
            identity = char_data_copy.pop("identity", "")
            detailed_setting = char_data_copy.pop("detailed_setting", {})
            title = char_data_copy.pop("title", "")
            avatar_url = char_data_copy.pop("avatar_url", "")
            description = char_data_copy.pop("description", "")

            # 创建字符对象
            character = Character(
                id=char_id,
                name=name,
                identity=identity,
                detailed_setting=detailed_setting,
                title=title,
                description=description,
                avatar_url=avatar_url,
            )

            db_session.add(character)
            migrated_count += 1

        db_session.commit()
        print(f"成功迁移 {migrated_count} 个字符")

    except Exception as e:
        db_session.rollback()
        print(f"迁移字符数据时出错: {e}")
        import traceback

        traceback.print_exc()

    finally:
        db_session.close()


def migrate_sessions():
    """迁移会话数据"""
    print("开始迁移会话数据...")

    # 读取 TinyDB 会话数据
    sessions_data = read_tinydb_json(Path("./data/sessions.json"))

    if not sessions_data:
        print("未找到会话数据，跳过迁移")
        return

    db_session = SessionLocal()
    migrated_count = 0

    try:
        for session_data in sessions_data:
            # 确保 session_data 是字典
            if not isinstance(session_data, dict):
                print(f"跳过非字典类型的会话数据: {session_data}")
                continue

            # 复制数据以避免修改原始字典
            session_data_copy = session_data.copy()

            # 处理 ID
            if "_id" in session_data_copy:
                session_id = session_data_copy.pop("_id")
            elif "id" in session_data_copy:
                session_id = session_data_copy["id"]
            else:
                session_id = str(ulid.new())
                session_data_copy["id"] = session_id

            # 创建会话对象
            session = SessionModel(
                id=session_id,
                name="test",
                user_id=session_data_copy.get("user_id", ""),
                character_id=session_data_copy.get("character_id", ""),
                memory_type=session_data_copy.get("memory_type"),
                model=session_data_copy.get("model"),
            )

            db_session.add(session)
            migrated_count += 1

        db_session.commit()
        print(f"成功迁移 {migrated_count} 个会话")

    except Exception as e:
        db_session.rollback()
        print(f"迁移会话数据时出错: {e}")
        import traceback

        traceback.print_exc()

    finally:
        db_session.close()


def migrate_messages():
    """迁移消息数据"""
    print("开始迁移消息数据...")

    # 读取 TinyDB 消息数据
    messages_data = read_tinydb_json(Path("./data/messages.json"))

    if not messages_data:
        print("未找到消息数据，跳过迁移")
        return

    db_session = SessionLocal()
    migrated_count = 0

    try:
        for msg_data in messages_data:
            # 确保 msg_data 是字典
            if not isinstance(msg_data, dict):
                print(f"跳过非字典类型的消息数据: {msg_data}")
                continue

            # 复制数据以避免修改原始字典
            msg_data_copy = msg_data.copy()

            # 处理 ID
            if "_id" in msg_data_copy:
                msg_id = msg_data_copy.pop("_id")
            elif "id" in msg_data_copy:
                msg_id = msg_data_copy["id"]
            else:
                msg_id = str(ulid.new())
                msg_data_copy["id"] = msg_id

            # 创建消息对象
            message = Message(
                id=msg_id,
                session_id=msg_data_copy.get("session_id", ""),
                role=msg_data_copy.get("role", ""),
                content=msg_data_copy.get("content", ""),
                reasoning_content=msg_data_copy.get("reasoning_content"),
                parent_id=msg_data_copy.get("parent_id"),
            )

            db_session.add(message)
            migrated_count += 1

        db_session.commit()
        print(f"成功迁移 {migrated_count} 条消息")

    except Exception as e:
        db_session.rollback()
        print(f"迁移消息数据时出错: {e}")
        import traceback

        traceback.print_exc()

    finally:
        db_session.close()


def migrate_summaries():
    """迁移摘要数据"""
    print("开始迁移摘要数据...")

    # 读取 TinyDB 摘要数据
    summaries_data = read_tinydb_json(Path("./data/summaries.json"))

    if not summaries_data:
        print("未找到摘要数据，跳过迁移")
        return

    db_session = SessionLocal()
    migrated_count = 0

    try:
        for summary_data in summaries_data:
            # 确保 summary_data 是字典
            if not isinstance(summary_data, dict):
                print(f"跳过非字典类型的摘要数据: {summary_data}")
                continue

            # 复制数据以避免修改原始字典
            summary_data_copy = summary_data.copy()

            # 处理 session_id
            if "_id" in summary_data_copy:
                id = summary_data_copy.pop("_id")
            elif "id" in summary_data_copy:
                id = summary_data_copy["session_id"]
            else:
                id = str(ulid.new())

            # 创建摘要对象
            summary = Summary(
                id=id,
                session_id=summary_data_copy.get("session_id"),
                master_summary=summary_data_copy.get("master_summary"),
                last_message_id=summary_data_copy.get("last_message_id"),
                history=json.dumps(summary_data_copy.get("history", [])),
            )

            db_session.add(summary)
            migrated_count += 1

        db_session.commit()
        print(f"成功迁移 {migrated_count} 个摘要")

    except Exception as e:
        db_session.rollback()
        print(f"迁移摘要数据时出错: {e}")
        import traceback

        traceback.print_exc()

    finally:
        db_session.close()


def backup_tinydb_files():
    """备份原始 TinyDB 文件"""
    print("开始备份原始数据文件...")

    backup_dir = Path("./data/backup")
    backup_dir.mkdir(exist_ok=True)

    files_to_backup = [
        "ai_characters.json",
        "sessions.json",
        "messages.json",
        "summaries.json",
    ]

    for file_name in files_to_backup:
        source_path = Path(f"./data/{file_name}")
        if source_path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = backup_dir / f"{file_name}.backup_{timestamp}"

            import shutil

            shutil.copy2(source_path, backup_path)
            print(f"已备份: {file_name} -> {backup_path.name}")


def verify_migration():
    """验证迁移结果"""
    print("\n开始验证迁移结果...")

    db_session = SessionLocal()

    try:
        # 验证字符数据
        char_count = db_session.query(Character).count()
        print(f"数据库中的字符数量: {char_count}")

        # 验证会话数据
        session_count = db_session.query(SessionModel).count()
        print(f"数据库中的会话数量: {session_count}")

        # 验证消息数据
        message_count = db_session.query(Message).count()
        print(f"数据库中的消息数量: {message_count}")

        # 验证摘要数据
        summary_count = db_session.query(Summary).count()
        print(f"数据库中的摘要数量: {summary_count}")

        # 检查是否有重复数据
        char_ids = [char.id for char in db_session.query(Character).all()]
        if len(char_ids) != len(set(char_ids)):
            print("警告: 发现重复的字符ID")

        session_ids = [session.id for session in db_session.query(SessionModel).all()]
        if len(session_ids) != len(set(session_ids)):
            print("警告: 发现重复的会话ID")

        message_ids = [msg.id for msg in db_session.query(Message).all()]
        if len(message_ids) != len(set(message_ids)):
            print("警告: 发现重复的消息ID")

        summary_session_ids = [
            summary.session_id for summary in db_session.query(Summary).all()
        ]
        if len(summary_session_ids) != len(set(summary_session_ids)):
            print("警告: 发现重复的会话ID在摘要表中")

    except Exception as e:
        print(f"验证过程中出错: {e}")
        import traceback

        traceback.print_exc()

    finally:
        db_session.close()


def main():
    """主迁移函数"""
    print("=" * 50)
    print("TinyDB 到 SQLite 数据迁移工具")
    print("=" * 50)

    # 备份原始数据
    backup_tinydb_files()

    # 执行迁移
    migrate_characters()
    migrate_sessions()
    migrate_messages()
    migrate_summaries()

    # 验证迁移结果
    verify_migration()

    print("\n迁移完成!")
    print("请注意: 原始数据已备份到 ./data/backup/ 目录")
    print("建议在确认迁移成功后，再删除或归档原始JSON文件")


if __name__ == "__main__":
    main()
