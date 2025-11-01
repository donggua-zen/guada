# summary_service.py
import re
from sqlalchemy.orm import Session
from models import SessionLocal, Summary as SummaryModel
from typing import NamedTuple, Optional
from utils.chunking import chunking_messages
from llm_service import LLMService, LLMServiceChunk
from llm_service_factory import llm_service_factory
import json


class CompressionResult(NamedTuple):
    summaries: Optional[list[dict]] = None
    last_message_id: Optional[str] = None
    active_messages: Optional[list] = None


class _SummaryService:
    def __init__(self):
        self.db_session = SessionLocal()
        llm_service = llm_service_factory.get_service("aliyun")
        self.llm_service = llm_service

    def __del__(self):
        self.db_session.close()

    def get_last_message_id(self, session_id: str):
        summary = (
            self.db_session.query(SummaryModel)
            .filter(SummaryModel.session_id == session_id)
            .first()
        )
        if summary and summary.last_message_id:
            return summary.last_message_id
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
        # 实现保持不变
        processed = []
        for msg in history:
            content = msg["content"]
            content = re.sub(r"\s{2,}", " ", content)
            content = content.replace("\n", " ")
            content = content.strip()
            if len(content) > 700:
                content = content[:200] + "..." + content[-500:]
            processed.append({"role": msg["role"], "content": content})
        return processed

    def generate_master_summary(self, character, summaries: list[dict]):
        """使用同一模型生成对话摘要"""
        # 实现保持不变
        system_prompt = (
            """你是一个专业的剧情摘要生成器，需要将故事内容压缩为更简洁的剧情摘要。"""
        )
        # ... 其余提示词保持不变

        prompt = "以下是你要浓缩的剧情内容：\n\n"

        for summary in summaries:
            prompt += summary["content"]
            prompt += "\n"
        return self.call_llm(
            None,
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
        )

    def generate_recent_summary(
        self, character, last_summary: str, messages: list[dict]
    ):
        """使用同一模型生成对话摘要"""
        # 实现保持不变
        history = self.preprocess_dialogue(messages)
        dialogue_records = "".join(
            [
                f"<{msg['role']}_message>{msg['content']}</{msg['role']}_message>"
                for msg in history
            ]
        )

        system_prompt = (
            """你是一个专业的剧情摘要生成器，需要将对话内容压缩为简洁的剧情摘要。"""
        )
        # ... 其余提示词保持不变

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
            None,
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
        )

    def conditionally_compress_history(
        self, session_id: str, character: dict, messages: list
    ):
        HISTORY_THRESHOLD = 5

        summary = (
            self.db_session.query(SummaryModel)
            .filter(SummaryModel.session_id == session_id)
            .first()
        )

        if summary is None:
            summary = SummaryModel(
                session_id=session_id,
                master_summary="",
                last_message_id="",
                history="[]",
            )
            self.db_session.add(summary)

        summaries = json.loads(summary.history) if summary.history else []

        chunks = chunking_messages(
            messages=messages,
            max_threshold=2000,
            safe_threshold=1000,
            chunk_size=1000,
        )

        if summary.master_summary and summary.master_summary != "":
            summaries.append({"content": summary.master_summary})

        if len(chunks) > 1:
            for i, chunk in enumerate(chunks[:-1]):
                print(f"生成对话摘要中 chunk:{i}/{len(chunks)} msgs:{len(chunk)}")

                response = self.generate_recent_summary(
                    character=character,
                    last_summary=(
                        summaries[-1]["content"] if len(summaries) > 0 else "(无)"
                    ),
                    messages=chunk,
                )

                # 更新压缩历史
                summaries.append({"content": response.content})
                summary.history = json.dumps(summaries)
                summary.last_message_id = chunk[-1]["id"]
                print(f"新摘要生成成功！当前摘要长度: {len(response.content)}字符")
                print(f"摘要内容: {response.content}")

        if len(summaries) >= HISTORY_THRESHOLD:
            print("生成全局摘要中...")
            response = self.generate_master_summary(
                character=character, summaries=summaries
            )
            summary.master_summary = response.content
            summary.history = None

        active_messages = chunks[-1] if len(chunks) > 0 else []

        self.db_session.commit()

        return CompressionResult(
            summaries=summaries,
            last_message_id=summary.last_message_id,
            active_messages=active_messages,
        )

    def delete_summary_by_session_id(self, session_id):
        summary = (
            self.db_session.query(SummaryModel)
            .filter(SummaryModel.session_id == session_id)
            .first()
        )
        if summary:
            self.db_session.delete(summary)
            self.db_session.commit()


_summary_service = _SummaryService()


def get_summary_service() -> _SummaryService:
    return _summary_service
