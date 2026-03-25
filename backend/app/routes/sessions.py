import datetime
from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException
from app.dependencies import get_session_service, get_current_user
from app.schemas.common import PaginatedResponse
from app.services.session_service import SessionService
from app.models.user import User
from app.schemas.session import SessionCreate, SessionItemOut, SessionOut, SessionUpdate
from app.utils.vector_memory import get_vector_memory


vector_memory = get_vector_memory()

sessions_router = APIRouter(prefix="/api/v1")


@sessions_router.get("/sessions", response_model=PaginatedResponse[SessionItemOut])
async def get_sessions(
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    return await session_service.get_sessions(current_user)


@sessions_router.post("/sessions", response_model=SessionOut)
async def create_session(
    request: SessionCreate,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    session_data = request.model_dump(exclude_unset=True)
    return await session_service.create_session(current_user, session_data)


@sessions_router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    await session_service.delete_session(session_id, current_user)
    vector_memory.delete_session_memories(session_id)


@sessions_router.get("/sessions/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: str,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    data = await session_service.get_session(session_id, current_user)
    if not data:
        raise HTTPException(status_code=404, detail=f"Session with ID {session_id} not found.")
    return data


@sessions_router.put("/sessions/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: str,
    request: SessionUpdate,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    data = request.model_dump(exclude_unset=True)
    data["updated_at"] = datetime.datetime.now(datetime.timezone.utc)

    return await session_service.update_session(session_id, current_user, data)


@sessions_router.post("/sessions/{session_id}/generate-title", response_model=dict)
async def generate_session_title(
    session_id: str,
    session_service: SessionService = Depends(get_session_service),
    current_user: User = Depends(get_current_user),
):
    """根据会话的第一轮对话生成标题
    
    在用户完成第一轮对话后调用此接口，自动生成会话标题。
    如果会话未配置模型或消息不足，则跳过标题生成。
    """
    return await session_service.generate_session_title(session_id, current_user)