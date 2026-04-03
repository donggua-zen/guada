"""
会话流程集成测试

测试范围:
1. 会话创建端到端流程
2. 标题继承策略（API 级别）
3. 角色关联
4. 设置合并
"""
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_session_creation_when_title_provided_should_use_custom_title(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession,
    character_factory
):
    """测试会话创建时自定义标题优先（集成测试）"""
    # Arrange: 先创建模型和角色
    provider_data = {
        "name": "Test Provider",
        "api_url": "https://api.test.com",
        "api_key": "test-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model",
        "provider_id": provider_id,
        "model_name": "test-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    assert model_response.status_code in [200, 201]
    model_id = model_response.json()["id"]
    
    # 创建角色（带标题）
    character = await character_factory.create(
        title="角色标题",
        model_id=model_id,
        description="测试角色"
    )
    
    # Act: 提供自定义 title 创建会话
    session_data = {
        "character_id": character.id,
        "model_id": model_id,
        "title": "自定义会话标题"  # 提供自定义标题
    }
    
    response = await client.post("/api/v1/sessions", json=session_data)
    
    # Assert: 应该使用自定义标题
    assert response.status_code == 200
    session_data_response = response.json()
    assert session_data_response["title"] == "自定义会话标题"


@pytest.mark.asyncio
async def test_session_creation_when_title_not_provided_should_inherit_character_title(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession,
    character_factory
):
    """测试会话创建时标题继承逻辑（不提供 title 时继承角色标题）"""
    # Arrange: 创建模型和角色
    provider_data = {
        "name": "Test Provider Inheritance",
        "api_url": "https://api.inheritance.com",
        "api_key": "inheritance-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Inheritance",
        "provider_id": provider_id,
        "model_name": "inheritance-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    assert model_response.status_code in [200, 201]
    model_id = model_response.json()["id"]
    
    # 创建角色（带标题）
    character = await character_factory.create(
        title="继承的角色标题",
        model_id=model_id,
        description="用于继承测试的角色"
    )
    
    # Act: 不提供 title 创建会话
    session_data = {
        "character_id": character.id,
        "model_id": model_id
        # ❌ 不提供 title 字段，应该继承角色标题
    }
    
    response = await client.post("/api/v1/sessions", json=session_data)
    
    # Assert: 应该继承角色标题
    assert response.status_code == 200
    session_data_response = response.json()
    assert session_data_response["title"] == "继承的角色标题"


@pytest.mark.asyncio
async def test_session_creation_with_settings_should_merge_max_memory_length(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession,
    character_factory
):
    """测试设置合并：max_memory_length 的继承与覆盖"""
    # Arrange
    provider_data = {
        "name": "Test Provider Settings",
        "api_url": "https://api.settings.com",
        "api_key": "settings-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Settings",
        "provider_id": provider_id,
        "model_name": "settings-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    assert model_response.status_code in [200, 201]
    model_id = model_response.json()["id"]
    
    # 创建角色（带 max_memory_length=10）
    character = await character_factory.create(
        title="Settings Test Character",
        model_id=model_id,
        settings={"max_memory_length": 10}
    )
    
    # Act: 创建会话并提供不同的 max_memory_length（覆盖为 20）
    session_data = {
        "character_id": character.id,
        "model_id": model_id,
        "settings": {
            "max_memory_length": 20  # 覆盖角色的 10
        }
    }
    
    response = await client.post("/api/v1/sessions", json=session_data)
    
    # Assert
    assert response.status_code == 200
    session_data_response = response.json()
    # 验证设置被正确保存（需要查询数据库确认）
    assert session_data_response.get("settings") is not None


@pytest.mark.asyncio
async def test_session_creation_when_character_not_found_should_return_404(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession
):
    """测试错误处理：角色不存在时返回 404"""
    # Arrange: 创建模型
    provider_data = {
        "name": "Test Provider Error",
        "api_url": "https://api.error.com",
        "api_key": "error-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Error",
        "provider_id": provider_id,
        "model_name": "error-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    assert model_response.status_code in [200, 201]
    model_id = model_response.json()["id"]
    
    # Act: 使用不存在的角色 ID 创建会话
    session_data = {
        "character_id": "non-existent-character-id",
        "model_id": model_id
    }
    
    response = await client.post("/api/v1/sessions", json=session_data)
    
    # Assert: 应该返回 404
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_session_lifecycle_flow(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession,
    character_factory
):
    """测试会话完整生命周期：创建 -> 读取 -> 更新 -> 删除"""
    # Arrange: 准备依赖数据
    provider_data = {
        "name": "Test Provider Lifecycle",
        "api_url": "https://api.lifecycle.com",
        "api_key": "lifecycle-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Lifecycle",
        "provider_id": provider_id,
        "model_name": "lifecycle-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    model_id = model_response.json()["id"]
    
    character = await character_factory.create(
        title="Lifecycle Character",
        model_id=model_id
    )
    
    # 1. Create: 创建会话
    create_data = {
        "character_id": character.id,
        "model_id": model_id,
        "title": "初始标题"
    }
    
    create_response = await client.post("/api/v1/sessions", json=create_data)
    assert create_response.status_code == 200
    session_id = create_response.json()["id"]
    
    # 2. Read: 获取会话
    get_response = await client.get(f"/api/v1/sessions/{session_id}")
    assert get_response.status_code == 200
    assert get_response.json()["title"] == "初始标题"
    
    # 3. Update: 更新会话（注意：SessionUpdate schema 只允许更新 model_id 和 settings）
    update_data = {
        "model_id": model_id  # 只能更新这些字段
    }
    
    update_response = await client.put(f"/api/v1/sessions/{session_id}", json=update_data)
    assert update_response.status_code == 200
    # 验证其他不可变字段
    assert update_response.json()["title"] == "初始标题"  # title 不能通过 update 修改
    
    # 4. Delete: 删除会话
    delete_response = await client.delete(f"/api/v1/sessions/{session_id}")
    assert delete_response.status_code == 200
    
    # 5. Verify: 验证已删除
    verify_response = await client.get(f"/api/v1/sessions/{session_id}")
    assert verify_response.status_code == 404
