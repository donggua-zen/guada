import os
import sys
import time


# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from chunking_messages import chunking_service
from session_service import session_service
from llm_service import LLMService
from llm_service_factory import llm_service_factory
from message_service import message_service
from character_service import ai_characters

# openai_base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1/"
# openai_api_key = "sk-b4ed412869c342b5b50a0f3177af5d5c"
# llm_model = "qwen3-30b-a3b-instruct-2507"

# openai_base_url = "https://api.siliconflow.cn/v1"
# openai_api_key = "sk-ccdjtlfjhfrkyhcsiijmwahhxaqnfplyaesoqigjvbizbmsy"

llm_model = "qwen3-30b-a3b-instruct-2507"
llm_service = llm_service_factory.get_service("aliyun")
chat_session_id = "01K5Z6KBE101G48BBM5T12WTPD"

# 获取聊天记录

session = session_service.query_session(session_id=chat_session_id)
if not session:
    raise Exception("Session not found")
character = ai_characters.get_character_by_id(session[0]["character_id"])
messages = message_service.get_messages(chat_session_id)

summares = []


def generate_summary(messages: list[dict], last_summary: str = None):
    """生成摘要"""
    dialogue_records = ""
    total = 0
    for message in messages:
        total += len(message["content"])
        dialogue_records += f"<{message['role']}_message>{message['content']}</{message['role']}_message>"
        system_prompt = """你是一个专业的剧情摘要生成器，需要将对话内容压缩为简洁的剧情摘要。

        # 核心原则
        1. **高度精简**：严格控制在300字内，只保留核心剧情推进内容。
        2. **保留关键**：包括情节转折、新角色/场景引入、重要决策或冲突。
        3. **客观叙述**：使用第三人称，忠于对话事实，不添加主观评价,不添加额外情节。
        4. **衔接流畅**：若提供前情提要，请自然衔接并避免重复。
        5. **敏感信息**：如涉及敏感词，请使用拼音替代。

        # 压缩技巧
        - 删除重复对话、寒暄及无实质内容的表达。
        - 合并相同事件或连续动作。
        - 用概括性语言替代详细对话（例如：“双方讨论了旅行计划”）。

        # 输出要求
        - 直接输出剧情摘要，无需额外解释。
        - 保持时间顺序和逻辑连贯。
        """

    prompt = f"""
    <background context="reference-only">
    角色名称：{character['name']}
    角色设定：{character['identity']}
    前情提要：{last_summary}
    </background>
    <input to-summarize="only-this-part">
    {dialogue_records}
    </input>
    现在，开始生成摘要：
    """

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


chunks = chunking_service.chunking(
    messages=messages,
    max_chunk_size=2000,
    short_term_memory_count=10,
    min_chunk_size=50,
    min_merge_size=100,
    max_short_term_chars=4000,
)
last_summary = ""
print(f"总块数: {len(chunks)}")
for i, chunk in enumerate(chunks):
    chunk_size = sum(len(msg["content"]) for msg in chunk)
    print(f"块 {i+1}: {len(chunk)}条消息, 总字数: {chunk_size}")

    for message in chunk:
        print(f"{message['role']}: {message['content'][:30]}...")

    if i >= len(chunks) - 1:
        print("  → 包含短期记忆消息")
    else:
        last_summary = generate_summary(chunk, last_summary)
    print("-" * 20)
