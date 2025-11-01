# 获取当前脚本的绝对路径
import os
import sys
from typing import Dict, List


current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from character_service import get_character_service
import utils.chunking as chunking
from message_service import get_message_service
from session_service import get_session_service


import random


def generate_test_messages(
    total_messages: int = 50,
    short_term_count: int = 10,
    min_content_length: int = 10,
    max_content_length: int = 1000,
    long_message_ratio: float = 0.2,
) -> List[Dict[str, str]]:
    """
    生成随机测试消息数据
    """
    messages = []

    for i in range(total_messages - short_term_count):
        is_long = random.random() < long_message_ratio
        if is_long:
            content_length = random.randint(
                max_content_length * 2, max_content_length * 10
            )
        else:
            content_length = random.randint(min_content_length, max_content_length)

        sentence_count = max(1, content_length // 20)
        content = generate_content(sentence_count, i + 1)
        role = "user" if random.random() < 0.5 else "assistant"
        messages.append({"role": role, "content": content})

    for i in range(short_term_count):
        content = f"最后{short_term_count}条消息{i+1}"
        role = "user" if random.random() < 0.5 else "assistant"
        messages.append({"role": role, "content": content})

    return messages


def generate_content(sentence_count: int, message_index: int) -> str:
    """
    生成包含多个句子的内容
    """
    sentences = []
    for j in range(sentence_count):
        templates = [
            f"这是第{message_index}条消息的第{j+1}句话",
            f"消息{message_index}的内容部分{j+1}",
            f"此处是对话记录中的第{message_index}段，第{j+1}句",
            f"对话内容{message_index}-{j+1}：这是一段随机生成的文本",
            f"第{message_index}次交流的第{j+1}个观点",
        ]
        sentence = random.choice(templates)

        if random.random() < 0.3:
            modifiers = [
                "，这是非常重要的。",
                "，需要特别注意。",
                "，请仔细阅读。",
                "，仅供参考。",
            ]
            sentence += random.choice(modifiers)

        sentences.append(sentence)

    return "。".join(sentences) + "。"


chat_session_id = "01K5Z6KBE101G48BBM5T12WTPD"

if __name__ == "__main__":
    test_messages = generate_test_messages(
        total_messages=30,
        short_term_count=5,
        min_content_length=5,
        max_content_length=500,
        long_message_ratio=0.0,
    )

    # 获取聊天记录

    session = get_session_service().query_session(session_id=chat_session_id)
    if not session:
        raise Exception("Session not found")
    character = get_character_service().get_character_by_id(session[0]["character_id"])
    messages = get_message_service().get_messages(chat_session_id)

    chunks = chunking.chunking_messages(
        messages=messages,
        max_threshold=2000,
        safe_threshold=1000,
        chunk_size=1000,
    )

    print(f"总块数: {len(chunks)}")
    for i, chunk in enumerate(chunks):
        chunk_size = sum(len(msg["content"]) for msg in chunk)
        print(f"块 {i+1}: {len(chunk)}条消息, 总字数: {chunk_size}")
        for msg in chunk:
            print(f"{msg['role']}: {msg['content'][:10]}...")
        print("-" * 30)
        if i >= len(chunks) - 1 and len(chunk) <= 5:
            print("  → 包含短期记忆消息")
