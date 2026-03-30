"""
会话服务单元测试

测试范围:
1. 会话创建逻辑
2. 标题继承策略（参数 title vs 角色 title）
3. 设置合并逻辑
4. 错误处理
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.session_service import SessionService
from app.models.user import User


class TestSessionServiceCreate:
    """测试会话创建逻辑"""
    
    @pytest.fixture
    def mock_repos(self, test_db_session):
        """创建 Mock 仓库依赖"""
        session_repo = AsyncMock()
        character_repo = AsyncMock()
        message_repo = AsyncMock()
        model_repo = AsyncMock()
        setting_service = AsyncMock()
        
        return {
            "session_repo": session_repo,
            "character_repo": character_repo,
            "message_repo": message_repo,
            "model_repo": model_repo,
            "setting_service": setting_service,
            "db_session": test_db_session
        }
    
    @pytest.fixture
    async def session_service(self, mock_repos):
        """创建 SessionService 实例"""
        service = SessionService(
            session_repo=mock_repos["session_repo"],
            character_repo=mock_repos["character_repo"],
            message_repo=mock_repos["message_repo"],
            model_repo=mock_repos["model_repo"],
            setting_service=mock_repos["setting_service"]
        )
        yield service
    
    @pytest.mark.asyncio
    async def test_create_session_when_title_provided_should_use_custom_title(
        self, session_service, mock_repos, user_factory
    ):
        """验证参数 title 优先于角色 title"""
        # Arrange: 创建 Mock 用户和角色
        user = await user_factory.create()
        
        mock_character = MagicMock()
        mock_character.id = "char-1"
        mock_character.title = "角色标题"
        mock_character.model_id = "model-1"
        mock_character.avatar_url = "/avatar.png"
        mock_character.description = "角色描述"
        mock_character.settings = {}
        
        mock_repos["character_repo"].get_character_by_id = AsyncMock(return_value=mock_character)
        
        # Mock _add_new_session 方法以捕获传入的数据
        captured_data = {}
        async def mock_add_session(data):
            captured_data.update(data)
            mock_session = MagicMock()
            mock_session.id = "sess-1"
            mock_session.title = data.get("title")
            return mock_session
        
        session_service._add_new_session = mock_add_session
        
        # Act: 提供自定义 title 创建会话
        data = {
            "character_id": "char-1",
            "title": "自定义标题",  # ✅ 提供自定义标题
            "model_id": "model-1"
        }
        
        result = await session_service.create_session(user, data)
        
        # Assert: 应该使用自定义标题
        assert result.title == "自定义标题"
        
        # 验证调用了正确的参数
        assert captured_data["title"] == "自定义标题"
    
    @pytest.mark.asyncio
    async def test_create_session_when_title_not_provided_should_inherit_character_title(
        self, session_service, mock_repos, user_factory
    ):
        """验证标题继承逻辑：不提供 title 时继承角色标题"""
        # Arrange
        user = await user_factory.create()
        
        mock_character = MagicMock()
        mock_character.id = "char-1"
        mock_character.title = "继承的角色标题"  # ✅ 角色标题
        mock_character.model_id = "model-1"
        mock_character.avatar_url = "/avatar.png"
        mock_character.description = "角色描述"
        mock_character.settings = {}
        
        mock_repos["character_repo"].get_character_by_id = AsyncMock(return_value=mock_character)
        
        # Mock _add_new_session 方法以捕获传入的数据
        captured_data = {}
        async def mock_add_session(data):
            captured_data.update(data)
            mock_session = MagicMock()
            mock_session.id = "sess-1"
            mock_session.title = data.get("title")
            return mock_session
        
        session_service._add_new_session = mock_add_session
        
        # Act: 不提供 title 创建会话
        data = {
            "character_id": "char-1",
            "model_id": "model-1"
            # ❌ 不提供 title 字段
        }
        
        result = await session_service.create_session(user, data)
        
        # Assert: 应该继承角色标题
        assert result.title == "继承的角色标题"
        
        # 验证继承逻辑
        assert captured_data["title"] == "继承的角色标题"
    
    @pytest.mark.asyncio
    async def test_create_session_when_character_not_found_should_raise_http_exception(
        self, session_service, mock_repos, user_factory
    ):
        """验证错误处理：角色不存在时抛出 404"""
        # Arrange
        user = await user_factory.create()
        
        mock_repos["character_repo"].get_character_by_id = AsyncMock(return_value=None)
        
        # Act & Assert: 应该抛出 404 错误
        data = {
            "character_id": "non-existent-id",
            "model_id": "model-1"
        }
        
        with pytest.raises(HTTPException) as exc_info:
            await session_service.create_session(user, data)
        
        assert exc_info.value.status_code == 404
        assert "not found" in exc_info.value.detail.lower()
    
    @pytest.mark.asyncio
    async def test_create_session_when_character_id_missing_should_raise_http_exception(
        self, session_service, mock_repos, user_factory
    ):
        """验证必填参数检查：缺少 character_id 时抛出 400"""
        # Arrange
        user = await user_factory.create()
        
        # Act & Assert: 应该抛出 400 错误
        data = {
            "model_id": "model-1"
            # ❌ 缺少 character_id
        }
        
        with pytest.raises(HTTPException) as exc_info:
            await session_service.create_session(user, data)
        
        assert exc_info.value.status_code == 400
        assert "character_id is required" in exc_info.value.detail


class TestSessionServiceSettings:
    """测试会话设置合并逻辑"""
    
    @pytest.fixture
    def mock_repos(self, test_db_session):
        """创建 Mock 仓库依赖"""
        session_repo = AsyncMock()
        character_repo = AsyncMock()
        message_repo = AsyncMock()
        model_repo = AsyncMock()
        setting_service = AsyncMock()
        
        return {
            "session_repo": session_repo,
            "character_repo": character_repo,
            "message_repo": message_repo,
            "model_repo": model_repo,
            "setting_service": setting_service,
            "db_session": test_db_session
        }
    
    @pytest.fixture
    async def session_service(self, mock_repos):
        """创建 SessionService 实例"""
        service = SessionService(
            session_repo=mock_repos["session_repo"],
            character_repo=mock_repos["character_repo"],
            message_repo=mock_repos["message_repo"],
            model_repo=mock_repos["model_repo"],
            setting_service=mock_repos["setting_service"]
        )
        yield service
    
    @pytest.mark.asyncio
    async def test_merge_settings_when_both_have_settings_should_prioritize_session(
        self, session_service, mock_repos, user_factory
    ):
        """验证设置合并策略：会话设置优先于角色设置"""
        # Arrange
        user = await user_factory.create()
        
        mock_character = MagicMock()
        mock_character.id = "char-1"
        mock_character.title = "角色"
        mock_character.model_id = "model-1"
        mock_character.avatar_url = "/avatar.png"
        mock_character.description = "描述"
        # 角色设置
        mock_character.settings = {
            "max_memory_length": 10,
            "system_prompt": "角色系统提示词"
        }
        
        mock_repos["character_repo"].get_character_by_id = AsyncMock(return_value=mock_character)
        
        # Mock _add_new_session 方法以捕获设置数据
        captured_data = {}
        async def mock_add_session(data):
            captured_data.update(data)
            mock_session = MagicMock()
            mock_session.id = "sess-1"
            mock_session.settings = data.get("settings", {})
            return mock_session
        
        session_service._add_new_session = mock_add_session
        
        # Act: 提供会话设置（覆盖角色的 max_memory_length）
        data = {
            "character_id": "char-1",
            "model_id": "model-1",
            "settings": {
                "max_memory_length": 20  # ✅ 覆盖角色的 10
            }
        }
        
        result = await session_service.create_session(user, data)
        
        # Assert: 验证设置合并
        assert captured_data["settings"]["max_memory_length"] == 20
    
    @pytest.mark.asyncio
    async def test_merge_settings_when_only_character_has_settings_should_inherit(
        self, session_service, mock_repos, user_factory
    ):
        """验证设置继承：仅角色有设置时继承 max_memory_length"""
        # Arrange
        user = await user_factory.create()
        
        mock_character = MagicMock()
        mock_character.id = "char-1"
        mock_character.title = "角色"
        mock_character.model_id = "model-1"
        mock_character.avatar_url = "/avatar.png"
        mock_character.description = "描述"
        mock_character.settings = {
            "max_memory_length": 15
        }
        
        mock_repos["character_repo"].get_character_by_id = AsyncMock(return_value=mock_character)
        
        # Mock _add_new_session 方法以捕获设置数据
        captured_data = {}
        async def mock_add_session(data):
            captured_data.update(data)
            mock_session = MagicMock()
            mock_session.id = "sess-1"
            mock_session.settings = data.get("settings", {})
            return mock_session
        
        session_service._add_new_session = mock_add_session
        
        # Act: 不提供 settings
        data = {
            "character_id": "char-1",
            "model_id": "model-1"
            # ❌ 不提供 settings
        }
        
        result = await session_service.create_session(user, data)
        
        # Assert: 应该继承角色的 max_memory_length
        assert captured_data["settings"]["max_memory_length"] == 15


# 待确认事项测试（跳过）
class TestSessionServiceEdgeCases:
    """边界情况测试（待确认）"""
    
    @pytest.mark.skip(reason="待确认：如果角色没有 title 字段，会话标题应该如何处理？")
    @pytest.mark.asyncio
    async def test_create_session_when_character_no_title_should_use_default(
        self, session_service, mock_repos, user_factory
    ):
        """
        待确认问题:
        - 如果角色 title 为 null，会话标题应该是什么？
        - 建议使用："新会话" + 时间戳
        
        影响测试：本测试
        决策者：@产品经理
        截止日期：2026-04-03
        """
        pass
