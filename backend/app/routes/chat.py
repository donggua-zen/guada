from asyncio import CancelledError
import asyncio
import json
import logging
from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from app.dependencies import get_agent_service
from app.services.agent_service import AgentService
from fastapi import BackgroundTasks

chat_router = APIRouter(prefix="/api/v1")

logger = logging.getLogger(__name__)


# 流式响应
async def stream_generator(
    request: Request,
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
            if await request.is_disconnected():  # 判断是否已断开连接
                logger.debug("Client disconnected.")
                await generator.aclose()
                break
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


@chat_router.post("/sessions/{session_id}/messages/stream")
async def chat_completions(
    session_id: str,
    request: Request,
    chat_service: AgentService = Depends(get_agent_service),
):
    data = await request.json()
    message_id = data.get("message_id")
    regeneration_mode = data.get("regeneration_mode", "overwrite") or "overwrite"
    assistant_message_id = data.get("assistant_message_id")

    if regeneration_mode not in ["overwrite", "multi_version", "append"]:
        raise HTTPException(status_code=400, detail="Invalid regeneration mode")

    return StreamingResponse(
        stream_generator(
            request,
            session_id,
            message_id,
            regeneration_mode=regeneration_mode,
            assistant_message_id=assistant_message_id,
            chat_service=chat_service,
        ),
        media_type="text/event-stream",
    )


@chat_router.get("/sessions/{session_id}/tokens")
async def get_tokens(
    session_id: str, chat_service: AgentService = Depends(get_agent_service)
):
    return await chat_service.token_statistics(session_id)
