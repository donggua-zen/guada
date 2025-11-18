import os
import sys
import time


# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from app.auto_tokenizer.auto_tokenizer import AutoTokenizer
from app.utils.chunking import chunking_messages
from app.services import ModelService, LLMService
from app import create_app

app = create_app()
model_service = ModelService()

with app.app_context():

    model = model_service.get_model_by_name(
        "deepseek-ai/DeepSeek-V3.2-Exp", provider_name="硅基流动"
    )

    provider = model_service.get_provider_by_name("硅基流动")

    if provider is None:
        print("未找到模型")
        exit(1)

    llm_service = LLMService(provider["api_url"], provider["api_key"])

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

        sysetm_prompt = f"""# 任务：对话摘要更新与维护

## 角色定义
你是一名专业的对话记录与分析专家，负责基于历史摘要和新增对话内容，动态维护一个准确、简洁且结构化的对话摘要。

## 核心目标
通过系统化分析新旧信息，生成更新的对话摘要，确保摘要内容具备连续性、关键信息完整性和客观中立性。

## 操作流程

### 1. 关键信息识别
仔细分析新对话内容，识别符合以下任一标准的关键信息点：
- **高特异性内容**：包含唯一名称、精确数值、具体日期、详细技术参数等。
- **情感信号**：用户表达强烈情绪（如兴奋、失望、焦虑）的语句。
- **叙事关键点**：标志话题开始、转折或结论的核心语句。
- **用户画像信息**：涉及用户个人背景、偏好、人际关系或世界观的新事实。
- **实体关联**：提及的特定人物、地点、组织、物品等实体及其关系。

### 2. 摘要结构化更新
基于旧摘要与新对话内容，按以下模块更新摘要（若旧摘要中无某模块，需新建）：

- **最新决策**  
  记录本轮对话中已确认的行动计划或当前聚焦议题。

- **待办事项**  
  列出所有明确提及但是未解决的任务项；已完成任务需移除此列表。

- **备忘录**  
  存储需长期记忆的用户关键信息和决策（如职业、技能、重要日期等）。  
  **冲突处理原则**：若新旧信息冲突，以最新对话内容为准并标注修订。
  **归纳总结**：相似相同内容需要合并，避免冗余。过时信息需要删除。例如已有“用户技能”，就不要出现“新增技能”分类，而是直接归纳到已有分类。

- **历史摘要**  
  - **内容压缩**：高度概括本次对话的核心内容和事件，聚焦事实与结果而非决策过程。
  - **仅允许追加**：将压缩后的内容追加到历史摘要中。
  

### 3. 内容质量控制
- **简洁性**：每项描述需精炼，避免冗余。
- **中立性**：仅记录事实，不添加主观解读。
- **完整性**：确保关键信息无遗漏。

## 摘要格式示例
最新决策:
- 用户计划在本周五前完成博客框架搭建。
待办事项:
- 注册博客域名
- 设计首页布局
备忘录:
- 用户职业：后端开发工程师
- 擅长技术栈：Java, Spring Cloud, Docker
历史摘要:
- 用户提出创建技术博客的需求。
    
## 输入数据
- **旧摘要**：  
  {last_summary}

- **新对话记录**：  
  {dialogue_records}

## 输出要求
直接输出更新后的完整摘要内容，无需任何前缀或解释性文字。
    """
        print("Generating summary...")
        start_time = time.time()

        context_message = [
            {"role": "user", "content": sysetm_prompt},
        ]

        results = llm_service.completions(
            "deepseek-ai/DeepSeek-V3.2-Exp",
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
        # break
