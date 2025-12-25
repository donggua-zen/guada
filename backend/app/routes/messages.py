import logging
from fastapi import APIRouter, Depends, Request
from app.dependencies import get_current_user, get_message_service
from app.models.user import User
from app.schemas.common import PaginatedResponse
from app.schemas.message import MessageCreate, MessageOut, MessageUpdate
from app.schemas.message_content import MessageContentActive
from app.services import MessageService

# vector_memory = get_vector_memory()
# message_service = MessageService()
# summary_service = SummaryService()
# session_service = SessionService()


logger = logging.getLogger(__name__)
messages_router = APIRouter(prefix="/api/v1")


@messages_router.get(
    "/sessions/{session_id}/messages", response_model=PaginatedResponse[MessageOut]
)
async def get_messages(
    session_id,
    message_service: MessageService = Depends(get_message_service),
    _: User = Depends(get_current_user),
):
    return await message_service.get_messages(session_id=session_id)


@messages_router.delete("/sessions/{session_id}/messages")
async def clear_session_messages(
    session_id,
    message_service: MessageService = Depends(get_message_service),
    _: User = Depends(get_current_user),
):
    await message_service.delete_messages_by_session_id(session_id)


@messages_router.delete("/messages/{message_id}")
async def delete_message(
    message_id,
    message_service: MessageService = Depends(get_message_service),
    _: User = Depends(get_current_user),
):
    await message_service.delete_message(message_id)


@messages_router.put("/messages/{message_id}", response_model=MessageOut)
async def update_message(
    message_id,
    message: MessageUpdate,
    message_service: MessageService = Depends(get_message_service),
    _: User = Depends(get_current_user),
):
    return await message_service.update_message(
        message_id, {"content": message.content}
    )


@messages_router.post("/sessions/{session_id}/messages", response_model=MessageOut)
async def add_message(
    session_id,
    message: MessageCreate,
    message_service: MessageService = Depends(get_message_service),
    _: User = Depends(get_current_user),
):
    # 添加新消息到完整历史
    return await message_service.add_message(
        session_id=session_id,
        role="user",
        content=message.content,
        files=[file.model_dump() for file in message.files],
        replace_message_id=message.replace_message_id,
        parent_id=None,
    )


@messages_router.put("/message-content/{content_id}/active")
async def update_message_active_content(
    content_id,
    message_content_active: MessageContentActive,
    message_service: MessageService = Depends(get_message_service),
    _: User = Depends(get_current_user),
):
    message_id = message_content_active.message_id
    await message_service.set_message_current_content(
        message_id=message_id, content_id=content_id
    )


@messages_router.post("/sessions/{session_id}/messages/import")
async def import_messages(
    session_id,
    request: Request,
    message_service: MessageService = Depends(get_message_service),
    _: User = Depends(get_current_user),
):
    messages = await request.json()
    await message_service.import_messages(session_id, messages)
