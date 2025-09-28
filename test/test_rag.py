import os
import sys
import time


current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from character_service import get_character_service
from chunking import chunking_text, preprocess_text
from llm_service_factory import llm_service_factory
from message_service import get_message_service
from session_service import get_session_service
from vector_memory import get_vector_memory

session_service = get_session_service()
ai_characters = get_character_service()
message_service = get_message_service()
vector_memory = get_vector_memory()

llm_service = llm_service_factory.get_service("aliyun")
chat_session_id = "01K5Z6KBE101G48BBM5T12WTPD"

# 获取聊天记录

session = session_service.query_session(session_id=chat_session_id)
if not session:
    raise Exception("Session not found")
character = ai_characters.get_character_by_id(session[0]["character_id"])
messages = message_service.get_messages(chat_session_id)


def generate_summary(messages: list[dict]):
    llm_model = "qwen3-30b-a3b-instruct-2507"
    llm_service = llm_service_factory.get_service("aliyun")
    chat_session_id = "01K5Z6KBE101G48BBM5T12WTPD"
    """生成摘要"""
    dialogue_records = ""
    total = 0
    for message in messages:
        total += len(message["content"])
        dialogue_records += f"<{message['role']}_message>{message['content']}</{message['role']}_message>"
    system_prompt = """你是一个专业的剧情关键词提取器，请使用中立客观的第三人称视角，从对话内容提取关键人物、关键地点、关键事件。assistant角色名称“琳雅”
    - 忠于事实，不得出现文本中没有的词汇
    如 小明历尽千辛万苦，在浪荡山上找到了小红。-> 小明,小红,小明寻找小红,浪荡山
    """

    prompt = dialogue_records

    print("Generating summary...")
    start_time = time.time()

    context_message = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]

    results = llm_service.generate_response(
        llm_model,
        context_message,
        stream=False,
        thinking=None,
        temperature=0.4,
    )
    print("Summary generated:")
    # 计算耗时
    response_time = time.time() - start_time
    print(f"Response generated in {response_time:.2f} seconds")

    print(f"input {total} chars, output {len(results.content)} chars")
    if hasattr(results, "reasoning_content"):
        print("reasoning_content:")
        print(results.reasoning_content)
    if hasattr(results, "content"):
        print("content:")
        print(results.content)
    return results.content


vector_memory.delete_session_memories(session_id="01K5Z6KBE101G48BBM5T12WTPD")
for i in range(0, len(messages), 2):
    #     keyword = generate_summary(messages[i:i + 2])
    #     vector_memory.add_memory(
    #             session_id="test",
    #             content=keyword,
    #             metadata={
    #                 "message_id_1": messages[i]["id"],
    #                 "message_id_2": messages[i + 1]["id"],
    #             },
    #         )
    content = f"{messages[i]['content']}{messages[i + 1]['content']}"
    chunks = chunking_text(
        preprocess_text(content), max_chunk_size=400, overlap_size=30, min_chunk_size=80
    )
    for chunk in chunks:
        print(f"chunk len: {len(chunk)}")
        print(chunk)
        vector_memory.add_memory(
            session_id="01K5Z6KBE101G48BBM5T12WTPD",
            content=chunk,
            metadata={
                "message_id_1": messages[i]["id"],
                "message_id_2": messages[i + 1]["id"],
            },
        )
    print("-" * 30)

memories = vector_memory.query_memories(
    session_id="01K5Z6KBE101G48BBM5T12WTPD",
    query_text="自己一个人静下来,你回忆起曾经的学校时光,和离开学校时小梅给你打的那通电话",
)
print("-" * 30)
print("-" * 30)
print("-" * 30)
for memory in memories:
    print(f"score:{memory['score']:.4f}")
    print(f"content:{memory['content']}")
    print("-" * 30)
