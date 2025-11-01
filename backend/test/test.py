import os
import sys
import time


# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from auto_tokenizer.auto_tokenizer import AutoTokenizer
from utils.chunking import chunking_messages
from session_service import get_session_service
from llm_service_factory import llm_service_factory
from message_service import get_message_service
from character_service import get_character_service

# openai_base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1/"
# openai_api_key = "sk-b4ed412869c342b5b50a0f3177af5d5c"
# llm_model = "qwen3-30b-a3b-instruct-2507"

# openai_base_url = "https://api.siliconflow.cn/v1"
# openai_api_key = "sk-ccdjtlfjhfrkyhcsiijmwahhxaqnfplyaesoqigjvbizbmsy"

llm_model = "deepseek-ai/DeepSeek-V3.2-Exp"
llm_service = llm_service_factory.get_service("siliconflow")
chat_session_id = "01K5Z6KBE101G48BBM5T12WTPD"

# 获取聊天记录

session = get_session_service().query_session(session_id=chat_session_id)
if not session:
    raise Exception("Session not found")
character = get_character_service().get_character_by_id(session[0]["character_id"])


summares = []


def generate_summary(messages: list[dict], last_summary: str = None):
    """使用同一模型生成对话摘要"""
    # 实现保持不变
    total = 0
    dialogue_records = "".join(
        [
            f"<{msg['role']}_message>{msg['content']}</{msg['role']}_message>"
            for msg in messages
        ]
    )

    sysetm_prompt = f"""# 任务：更新对话摘要
## 核心指令
你是一个注重细节的对话记录员。你的目标是创建一个能**最大化保持对话连续性**的摘要。

## 操作指南
请按以下步骤操作：

**第一步：识别关键内容**
快速扫描新对话，识别出符合以下任何一条标准的内容：
- **高具体性**：包含唯一名称、精确数字、特定日期、详细描述。
- **高情感价值**：用户表现出强烈情绪（开心、沮丧、担忧等）的陈述。
- **叙事节点**：标志着一个故事或话题开始、转折、结束的关键点。
- **用户偏好/事实**：关于用户自身、亲友、或他们世界观的任何新事实。
- **涉及实体**：与用户相关的任何实体（人、地点、物品等）。

**第二步：整合与更新**
将新识别的关键内容与旧摘要无缝整合。**宁可保留看似冗余的细节，也绝不丢失可能重要的信息。**

**第三步：保持简洁但完整**
摘要应该是一段连贯的文字，而不是列表。在保证完整性的前提下力求简洁。

**【旧摘要】**
{last_summary}

**【新对话】**
{dialogue_records}

请生成更新后的摘要,不需要添加任何解释说明（如“摘要：”）：
"""
    print("Generating summary...")
    start_time = time.time()

    context_message = [
        {"role": "user", "content": sysetm_prompt},
    ]

    results = llm_service.generate_response(
        llm_model,
        context_message,
        stream=False,
        thinking=False,
        temperature=0.6,
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


import re


def parse_chat_log(filename):
    """
    从本地文件导入聊天记录并解析为对话数组

    Args:
        filename (str): 聊天记录文件名

    Returns:
        list: 包含对话字典的列表，格式为 [{"role": "xxx", "content": "xxx"}, ...]
    """
    try:
        with open(filename, "r", encoding="utf-8") as file:
            content = file.read()
    except FileNotFoundError:
        print(f"错误：文件 '{filename}' 未找到")
        return []
    except Exception as e:
        print(f"读取文件时出错：{e}")
        return []

    # 使用正则表达式匹配对话块
    # 匹配模式：▶ ROLE: 后跟内容（可能跨多行），直到下一个▶或文件结束
    pattern = r"▶\s*(\w+)\s*:\s*(.*?)(?=\s*▶\s*\w+\s*:|$)"
    matches = re.findall(pattern, content, re.DOTALL)

    dialogues = []
    valid_roles = {"SYSTEM", "USER", "ASSISTANT"}

    for role, content in matches:
        # 将角色转换为小写（符合常见API格式）
        role_lower = role.strip().upper()

        # 只处理有效的角色
        if role_lower in valid_roles:
            # 过滤内容的前后空白
            cleaned_content = content.strip()

            # 如果内容不为空，则添加到对话列表
            if cleaned_content:
                dialogues.append(
                    {
                        "role": role_lower.lower(),  # 转换为小写：system, user, assistant
                        "content": cleaned_content,
                    }
                )

    return dialogues


# messages = get_message_service().get_messages(chat_session_id)
messages = parse_chat_log("../data/我的室友是幽灵.txt")

print(f"总消息数: {len(messages)}")


def count_tokens(model, text):
    tokenizer = AutoTokenizer.get_tokenizer(model)
    return tokenizer.count_tokens(text)


MAX_TOKENS = 8192
# recent_messages = []
# messages.reverse()
# total_tokens = 0
# for message in messages:
#     tokens = count_tokens(llm_model, message["content"])
#     if total_tokens + tokens > MAX_TOKENS:
#         break
#     recent_messages.append(message)
#     total_tokens += tokens

# print(f"保留消息数: {len(recent_messages)}")

# total_tokens = 0
# total_chars = 0
# for message in recent_messages:
#     # print(f"{message['role']}: {message['content'][:30]}...")
#     tokens = count_tokens(llm_model, message["content"])
#     total_tokens += tokens
#     total_chars += len(message["content"])
# print(f"{_tokens} tokens")

# print(f"total tokens: {total_tokens} ({total_chars})")
chunks = chunking_messages(
    messages=messages,
    max_threshold=MAX_TOKENS,
    safe_threshold=MAX_TOKENS // 2,
    chunk_size=MAX_TOKENS,
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
