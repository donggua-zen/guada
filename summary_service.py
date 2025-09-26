"""
对话摘要服务模块

该模块负责处理对话历史的压缩和摘要生成，主要功能包括：
1. 判断是否需要生成对话摘要
2. 调用大语言模型生成对话摘要
3. 管理对话历史的分块和压缩
4. 维护会话摘要状态的持久化存储

通过使用摘要技术，可以有效控制上下文长度，避免超出模型的最大上下文限制，
同时保留重要的对话历史信息。
"""

import os
import re
from typing import NamedTuple, Optional
from tinydb import Query, TinyDB
from chunking_messages import ChunkingMessages
from llm_service import LLMService, LLMServiceChunk
from llm_service_factory import llm_service_factory


# 新增一个具名元组来清晰定义返回值
class CompressionResult(NamedTuple):
    summaries: Optional[list[dict]] = None  # 更新后的摘要状态对象
    last_message_id: Optional[str] = None
    active_messages: Optional[list] = None  # 剩余部分的原始消息列表，将继续用于对


class _SummaryService:

    def __init__(self):
        llm_service = llm_service_factory.get_service("aliyun")
        self.llm_service = llm_service
        self.db = TinyDB("./data/summaries.json")
        self.chunking_service = ChunkingMessages()

    def should_generate_summary(self, messages: list):
        # 可配置参数
        MIN_MESSAGES = 6  # 最小消息数阈值
        MAX_MESSAGES = 50  # 消息数量压缩阈值
        CHARACTER_THRESHOLD = 1000  # 字符总数阈值
        TARGET_WAITERLINE = CHARACTER_THRESHOLD // 2  # 中间阈值

        messages_count = len(messages)

        # 消息太少不需要压缩
        if messages_count < MIN_MESSAGES:
            return False, 0

        # 消息数量过多时，直接压缩前半部分
        if messages_count > MAX_MESSAGES:
            return True, messages_count // 2

        character_total = 0
        split_index = 0
        need_compress = False

        # 遍历消息计算字符总数
        for index, msg in enumerate(messages):
            if msg["role"] == "system":
                continue
            character_total += len(msg["content"])

            # 记录达到中间阈值的位置
            if character_total > TARGET_WAITERLINE and split_index == 0:
                if msg["role"] == "assistant":
                    # 找到一个assistant消息，在这里分割能保证回合完整
                    split_index = index  # 分割点设在此条消息之后
            # 达到总阈值，标记需要压缩
            if character_total > CHARACTER_THRESHOLD and split_index != 0:
                print(f"字符总数超过阈值，需要压缩，当前总字符数: {character_total}")
                need_compress = True
                break
        print(f"字符总数: {character_total}, 分割点: {split_index}")
        return need_compress, split_index

    def get_last_message_id(self, session_id: str):
        summaries = self.db.search(Query().session_id == session_id)

        if len(summaries) > 0:
            summary = summaries[0]
            if "last_message_id" in summary:
                return summary["last_message_id"]
        return None

    def call_llm(self, model: str, messages: list) -> LLMServiceChunk:
        try:
            model = "qwen3-30b-a3b-instruct-2507"
            print(f"调用LLM {model}\n")
            return self.llm_service.generate_response(
                model, messages=messages, temperature=0.4, stream=False, thinking=False
            )
        except Exception as e:
            print("调用LLM失败:", e)
            return None

    def preprocess_dialogue(self, history):
        """对话记录预处理函数"""
        processed = []
        for msg in history:
            # 1. 基础清理=
            content = msg["content"]
            content = re.sub(r"\s{2,}", " ", content)  # 压缩多余空格
            content = content.replace("\n", " ")  # 删除换行符
            content = content.strip()  # 移除首尾空白
            # 4. 长度控制
            if len(content) > 700:  # 截断过长消息
                content = content[:200] + "..." + content[-500:]

            processed.append({"role": msg["role"], "content": content})

        return processed

    def generate_master_summary(self, character, summary):
        """使用同一模型生成对话摘要"""
        system_prompt = """你是一个专业的剧情摘要生成器，需要将故事内容压缩为更简洁的剧情摘要。

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
- 删除无关的情节、环境描写。

# 输出要求
- 直接输出剧情摘要，无需额外解释。
- 保持时间顺序和逻辑连贯。
"""
        prompt = "以下是你要浓缩的剧情内容：\n\n"
        if "master_summary" in summary and summary["master_summary"] != "":
            prompt += f"{summary['master_summary']}\n"
        for msg in summary["history"]:
            prompt += msg["content"]
            prompt += "\n"
        return self.call_llm(
            character["model"],
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
        )

    def generate_recent_summary(self, character, summary, messages):
        """使用同一模型生成对话摘要"""
        history = self.preprocess_dialogue(messages)
        dialogue_records = "".join(
            [
                f"<{msg['role']}_message>{msg['content']}</{msg['role']}_message>"
                for msg in history
            ]
        )
        last_summary = (
            summary["history"][-1]["content"]
            if len(summary["history"]) > 0
            else summary["master_summary"]
        )

        if last_summary == "":
            last_summary = "(无)"

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

        prompt = f"""<background context="reference-only">
角色名称：{character['name']}
角色设定：{character['identity']}
前情提要：{last_summary}
</background>
<input to-summarize="only-this-part">
{dialogue_records}
</input>
现在，开始生成摘要：
    """
        return self.call_llm(
            character["model"],
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
        )

    def conditionally_compress_history(
        self, session_id: str, character: dict, messages: list
    ):

        HISTORY_THRESHOLD = 5

        summaries = self.db.search(Query().session_id == session_id)
        summary = {
            "session_id": session_id,
            "history": [],
            "master_summary": None,
            "last_message_id": None,
        }

        if len(summaries) > 0:
            summary = summaries[0]

        generated = False

        if len(summary["history"]) >= HISTORY_THRESHOLD:
            print("生成全局摘要中...")
            response = self.generate_master_summary(
                character=character, summary=summary
            )
            summary["master_summary"] = response.content
            summary["history"] = []
            generated = True

        chunks = self.chunking_service.chunking(
            messages=messages,
            max_chunk_size=2000,
            short_term_memory_count=10,
            min_chunk_size=50,
            min_merge_size=100,
            max_short_term_chars=4000,
        )

        if len(chunks) > 1:
            for i, chunk in enumerate(chunks[:-1]):
                print(f"生成对话摘要中 chunk:{i}/{len(chunks)} msgs:{len(chunk)}")
                response = self.generate_recent_summary(
                    character=character,
                    summary=summary,
                    messages=chunk,
                )

                # 更新压缩历史（保留旧摘要的关键信息）
                summary["history"].append({"content": response.content})
                summary["last_message_id"] = chunk[-1]["id"]
                print(f"新摘要生成成功！当前摘要长度: {len(response.content)}字符")
                print(f"摘要内容: {response.content}")
                generated = True

        active_messages = chunks[-1] if len(chunks) > 0 else []

        if generated:
            if len(summaries) > 0:
                self.db.update(summary, Query().session_id == session_id)
            else:
                self.db.insert(summary)

        summaries_list = []
        if summary["master_summary"] is not None and summary["master_summary"] != "":
            summaries_list.append({"content": summary["master_summary"]})
        summaries_list.extend(summary["history"])
        # print("-"*30)
        # print(summaries_list)
        # print("-"*30)
        return CompressionResult(
            summaries=summaries_list,
            last_message_id=summary["last_message_id"],
            active_messages=active_messages,
        )

    def delete_summary_by_session_id(self, session_id):
        self.db.remove(Query().session_id == session_id)


_summary_service = _SummaryService()


def get_summary_service() -> _SummaryService:
    return _summary_service
