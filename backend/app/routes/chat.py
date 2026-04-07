from asyncio import CancelledError
import asyncio
import json
import logging
from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from app.dependencies import get_agent_service
from app.services.agent_service import AgentService
from app.schemas.chat import ChatStreamRequest

chat_router = APIRouter(prefix="/api/v1")

logger = logging.getLogger(__name__)


# 流式响应
async def stream_generator(
    session_id: str,
    message_id: str,
    regeneration_mode: str,
    assistant_message_id: str = None,
    chat_service: AgentService = None,
):
    generator = None
    try:
        # 获取异步生成器
        generator = chat_service.completions(
            session_id,
            message_id,
            regeneration_mode=regeneration_mode,
            assistant_message_id=assistant_message_id,
        )
        logger.debug("Generator started.")
        async for chunk in generator:
            json_chunk = json.dumps(chunk, ensure_ascii=False)
            yield f"data: {json_chunk}\n\n"
        yield "data: [DONE]\n\n"
        logger.debug("Generator ended.")
    except asyncio.CancelledError:
        logger.debug("Generator cancelled.")
        raise
    except Exception as e:
        logger.error(f"Stream generation error: {e}", exc_info=True)
        yield "data: [DONE]\n\n"


@chat_router.post("/chat/stream")
async def chat_completions(
    request: ChatStreamRequest,
    chat_service: AgentService = Depends(get_agent_service),
):
    session_id = request.session_id
    message_id = request.message_id
    regeneration_mode = request.regeneration_mode or "overwrite"
    assistant_message_id = request.assistant_message_id

    return StreamingResponse(
        stream_generator(
            session_id,
            message_id,
            regeneration_mode=regeneration_mode,
            assistant_message_id=assistant_message_id,
            chat_service=chat_service,
        ),
        media_type="text/event-stream",
    )
