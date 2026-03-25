# session_service.py
from app.models.user import User
from app.repositories.character_repository import CharacterRepository
from app.repositories.session_repository import SessionRepository as SessionRepo
from app.repositories.message_repository import MessageRepository as MessageRepo
from app.repositories.model_repository import ModelRepository
from app.services.upload_service import UploadService
from app.utils import convert_webpath_to_filepath, remove_file
from app.schemas.common import PaginatedResponse
from app.schemas.session import SessionOut
from fastapi import HTTPException
from app.services.settings_manager import SettingsManager
from app.services.chat.memory_manager_service import MemoryManagerService
import logging

logger = logging.getLogger(__name__)

# from app.models.db_transaction import get_transaction_manager


class SessionService:
    def __init__(
        self,
        session_repo: SessionRepo,
        character_repo: CharacterRepository,
        message_repo: MessageRepo,
        model_repo: ModelRepository,
        setting_service: SettingsManager,
    ):
        # 初始化 UploadService 实例，避免重复创建
        self.upload_service = UploadService()
        self.session_repo = session_repo
        self.character_repo = character_repo
        self.message_repo = message_repo
        self.model_repo = model_repo
        self.setting_service = setting_service
        # 初始化 MemoryManagerService
        self.memory_manager = MemoryManagerService(message_repo)

    def __del__(self):
        pass

    async def create_session(self, user: User, data: dict):
        character_id = data.get("character_id")
        if not character_id:
            raise HTTPException(status_code=400, detail="character_id is required")

        # 获取角色信息
        character = await self.character_repo.get_character_by_id(character_id)
        if not character:
            raise HTTPException(
                status_code=404, detail=f"Character with ID {character_id} not found"
            )

        # 继承角色配置，只允许覆盖 model_id和 settings.max_memory_length
        session_data = {
            "user_id": user.id,
            "character_id": character_id,  # 绑定角色
            "title": data.get("title", character.title),
            "avatar_url": character.avatar_url,  # 不再允许覆盖，直接使用角色的 avatar
            "description": character.description,  # 不再允许覆盖，直接使用角色的 description
            "model_id": data.get("model_id", character.model_id),  # 允许覆盖
        }

        # 合并 settings：只从角色继承 max_memory_length，然后合并用户传入的设置（用户设置优先）
        session_data["settings"] = {}

        # 1. 从角色继承 max_memory_length
        if character.settings and "max_memory_length" in character.settings:
            session_data["settings"]["max_memory_length"] = character.settings[
                "max_memory_length"
            ]

        # 2. 合并用户传入的设置（会覆盖继承的值）
        if data.get("settings"):
            session_data["settings"].update(data["settings"])
        session = await self._add_new_session(session_data)

        if session is None:
            raise HTTPException(status_code=500, detail="Failed to create session")

        return session

    async def get_sessions(self, user: User) -> list[dict]:
        sessions = await self.session_repo.get_sessions(user.id)
        return PaginatedResponse(items=sessions, size=len(sessions))

    async def _add_new_session(self, data: dict):

        fields = [
            "title",
            "description",
            "avatar_url",
            "user_id",
            "model_id",
            "character_id",
            "settings",
        ]

        data_filtered = {
            field: data.get(field) for field in fields if data.get(field) is not None
        }

        # 创建字符对象
        session = await self.session_repo.create_session(data_filtered)
        return session

    async def update_session(self, session_id, user: User, data: dict):

        # 验证会话是否属于当前用户
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )

        # 只允许更新 model_id 和 settings.max_memory_length
        allowed_fields = ["model_id", "settings"]
        filtered_data = {k: v for k, v in data.items() if k in allowed_fields}

        # 如果更新了 settings，只保留 max_memory_length
        if "settings" in filtered_data:
            filtered_data["settings"] = {
                "max_memory_length": filtered_data["settings"].get("max_memory_length"),
                "thinking_enabled": filtered_data["settings"].get("thinking_enabled"),
            }

        session.update(filtered_data)

        await self.session_repo.session.flush()
        await self.session_repo.session.refresh(session)
        return session

    async def query_session(
        self, session_id=None, user: User = None, character_id=None
    ):

        sessions = await self.session_repo.query_session(
            session_id, user.id if user else None, character_id
        )

        if not sessions:  # 如果没有查询到结果，则返回None
            return PaginatedResponse(items=[], size=0)

        return PaginatedResponse(
            items=[SessionOut.model_validate(s) for s in sessions], size=len(sessions)
        )

    async def delete_session(self, session_id, user: User):
        # 验证会话是否属于当前用户
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )

        await self.session_repo.delete_session(session_id)

    async def get_session(self, session_id, user: User):
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )
        return session

    async def generate_session_title(self, session_id: str, user: User) -> dict:
        """根据会话的第一轮对话生成标题

        Args:
            session_id: 会话 ID
            user: 当前用户

        Returns:
            dict: 包含新生成的标题
        """
        # 验证会话是否属于当前用户
        session = await self.session_repo.get_session_by_id(session_id)
        if not session or session.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Session with ID {session_id} does not exist or does not belong to user.",
            )

        # 从全局设置中获取标题总结模型
        title_model_id = self.setting_service.get("default_title_summary_model_id")

        if not title_model_id:
            logger.info(
                f"No default title summary model configured in settings, skipping title generation"
            )
            return {
                "title": session.title,
                "skipped": True,
                "reason": "no_title_model_configured",
            }

        # 使用 MemoryManagerService 获取最近的 3 条消息（已过滤系统消息，正序排列）
        recent_messages = await self.memory_manager.get_recent_messages_for_summary(
            session_id=session_id,
            model_name=title_model_id,
            prompt_settings={},  # 标题生成不需要系统消息
            disabled_tool_results=True,  # 禁用工具调用结果
        )

        if len(recent_messages) < 2:
            logger.info(
                f"Session {session_id} has less than 2 non-system messages, skipping title generation"
            )
            return {
                "title": session.title,
                "skipped": True,
                "reason": "insufficient_messages",
            }

        # 获取全局设置中的标题总结提示词
        title_prompt = self.setting_service.get(
            "default_title_summary_prompt",
            "请根据以下对话内容，生成一个简洁、准确且具有描述性的会话标题（不超过 20 个字）。直接返回标题即可，不需要其他解释。",
        )

        # 验证模型是否存在
        model = await self.model_repo.get_model(title_model_id)
        if not model:
            logger.error(f"Title model {title_model_id} not found in settings")
            return {
                "title": session.title,
                "skipped": True,
                "reason": "title_model_not_found",
            }

        # 从最近的消息中提取用户和助手消息（已经是正序：从旧到新）
        user_message = next((m for m in recent_messages if m["role"] == "user"), None)
        assistant_message = next(
            (m for m in recent_messages if m["role"] == "assistant"), None
        )

        if not user_message or not assistant_message:
            logger.warning(
                f"Session {session_id} missing user or assistant message in recent messages"
            )
            return {
                "title": session.title,
                "skipped": True,
                "reason": "missing_messages",
            }

        # 构建提示词
        user_content = user_message.get("content", "")
        assistant_content = assistant_message.get("content", "")

        prompt = f"{title_prompt}\n\n用户问题：{user_content}\n\n助手回答：{assistant_content}\n\n生成的标题："

        try:
            # 调用 LLM 生成标题
            from app.services.domain.llm_service import LLMService

            # 从 model_repo 获取 provider
            provider = await self.model_repo.get_provider(model.provider_id)

            if not provider:
                logger.error(
                    f"Provider {model.provider_id} not found for model {title_model_id}"
                )
                return {
                    "title": session.title,
                    "skipped": True,
                    "reason": "provider_not_found",
                }

            llm_service = LLMService(provider.api_url, provider.api_key)

            # 调用模型生成标题
            response = await llm_service.completions(
                model=model.model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,  # 较低的温度使输出更稳定
                max_tokens=50,  # 限制输出长度
                stream=False,
            )

            # 提取生成的标题
            new_title = response.content.strip() if response.content else None

            if not new_title:
                logger.warning(f"Failed to generate title for session {session_id}")
                return {
                    "title": session.title,
                    "skipped": True,
                    "reason": "generation_failed",
                }

            # 更新会话标题
            session.title = new_title
            await self.session_repo.session.flush()
            await self.session_repo.session.refresh(session)

            logger.info(
                f"Successfully generated title '{new_title}' for session {session_id}"
            )

            return {"title": new_title, "skipped": False, "old_title": session.title}

        except Exception as e:
            logger.error(
                f"Error generating title for session {session_id}: {e}", exc_info=True
            )
            return {
                "title": session.title,
                "skipped": True,
                "reason": "error",
                "error": str(e),
            }
