# summary_service.py
from app.services.llm_service import LLMServiceChunk
from typing import NamedTuple, Optional
from app.utils.chunking import chunking_messages
from app.models import db, Summary
from app.models.db_transaction import smart_transaction_manager


class CompressionResult(NamedTuple):
    summary: Optional[str] = None
    last_message_id: Optional[str] = None
    active_messages: Optional[list] = None


class SummaryService:
    def __init__(self):
        pass
        llm_service = None
        self.llm_service = llm_service

    def __del__(self):
        pass

    def get_last_message_id(self, session_id: str):
        summary = (
            db.session.query(Summary).filter(Summary.session_id == session_id).first()
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

    def generate_recent_summary(
        self, character, last_summary: str, messages: list[dict]
    ):
        """使用同一模型生成对话摘要"""
        # 实现保持不变
        dialogue_records = "".join(
            [
                f"<{msg['role']}_message>{msg['content']}</{msg['role']}_message>"
                for msg in messages
            ]
        )

        prompt = f"""请你作为专业对话摘要师，对以下对话内容进行精准、简洁的摘要压缩。
 
1. 核心要求：完整保留对话的关键主体（人物/事物）、核心观点、关键决策及重要时间/数据，剔除重复、冗余、无关的语气词和寒暄内容，语言逻辑清晰、连贯。

2. 上下文关联：若提供了上一轮摘要（如下方【上一轮摘要】所示），请务必结合该摘要内容，优先延续其核心逻辑和关键信息，仅补充新增对话中的重要内容，避免信息重复或冲突。

3. 通用性适配：无论对话涉及生活、工作、学习、专业领域等任何场景，均需基于对话本身客观提炼，不添加主观推测或额外信息。
 
【上一轮摘要】
{last_summary}
 
【本次待压缩对话】
{dialogue_records}

请直接生成摘要文本，不要添加额外解释。
    """
        return self.call_llm(
            None,
            [
                {"role": "user", "content": prompt},
            ],
        )

    def conditionally_compress_history(
        self, session: dict, character: dict, messages: list
    ):
        HISTORY_THRESHOLD = 5

        summary = (
            db.session.query(Summary)
            .filter(Summary.session_id == session["id"])
            .first()
        )

        if summary is None:
            with smart_transaction_manager.transaction():
                summary = Summary(
                    session_id=session["id"],
                    master_summary="",
                    last_message_id="",
                    history="[]",
                )
                db.session.add(summary)

        chunks = chunking_messages(
            messages=messages,
            max_threshold=2000,
            safe_threshold=1000,
            chunk_size=1000,
        )

        print("生成全局摘要中...")
        response = self.generate_recent_summary(
            character=character,
            last_summary=summary.master_summary,
            messages=chunks[-1],
        )
        summary.master_summary = response.content
        summary.history = None

        active_messages = chunks[-1] if len(chunks) > 0 else []

        return CompressionResult(
            summary=summary.master_summary,
            last_message_id=summary.last_message_id,
            active_messages=active_messages,
        )

    def delete_summary_by_session_id(self, session_id):
        summary = (
            db.session.query(Summary).filter(Summary.session_id == session_id).first()
        )
        if summary:
            with smart_transaction_manager.transaction():
                db.session.delete(summary)
