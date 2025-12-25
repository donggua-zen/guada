import json
import logging
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.dependencies import get_chat_service
from app.services.chat_service import ChatService

chat_router = APIRouter(prefix="/api/v1")

logger = logging.getLogger(__name__)


# 流式响应
async def stream_generator(
    session_id: str,
    message_id: str,
    regeneration_mode: str,
    assistant_message_id: str = None,
    chat_service: ChatService = Depends(get_chat_service),
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
    except GeneratorExit:
        # 如果发生异常退出，则尝试关闭生成器
        if generator is not None:
            await generator.aclose()
        return
    except Exception as e:
        logger.error(f"Stream generation error: {e}", exc_info=True)
        yield "data: [DONE]\n\n"


@chat_router.post("/sessions/{session_id}/messages/stream")
async def chat_completions(
    session_id: str,
    request: Request,
    chat_service: ChatService = Depends(get_chat_service),
):
    data = await request.json()
    message_id = data.get("message_id")
    regeneration_mode = data.get("regeneration_mode", "overwrite") or "overwrite"
    assistant_message_id = data.get("assistant_message_id")

    if regeneration_mode not in ["overwrite", "multi_version", "append"]:
        raise ValueError("Invalid regeneration mode")

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


@chat_router.get("/sessions/{session_id}/tokens")
async def get_tokens(
    session_id: str, chat_service: ChatService = Depends(get_chat_service)
):
    return await chat_service.token_statistics(session_id)
