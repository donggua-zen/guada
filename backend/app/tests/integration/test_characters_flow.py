"""
角色流程集成测试

测试范围:
1. 角色创建端到端流程
2. 角色配置验证
3. 角色与会话关联
4. 共享角色功能
"""
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_character_lifecycle_flow(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession
):
    """测试角色完整生命周期：创建 -> 读取 -> 更新 -> 删除"""
    # Arrange: 准备依赖数据
    provider_data = {
        "name": "Test Provider Character",
        "api_url": "https://api.character.com",
        "api_key": "character-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Character",
        "provider_id": provider_id,
        "model_name": "character-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    assert model_response.status_code in [200, 201]
    model_id = model_response.json()["id"]
    
    # 1. Create: 创建角色
    create_data = {
        "title": "测试角色",
        "description": "用于生命周期测试的角色",
        "model_id": model_id,
        "is_public": False
    }
    
    create_response = await client.post("/api/v1/characters", json=create_data)
    assert create_response.status_code == 200
    character_id = create_response.json()["id"]
    assert create_response.json()["title"] == "测试角色"
    
    # 2. Read: 获取角色
    get_response = await client.get(f"/api/v1/characters/{character_id}")
    assert get_response.status_code == 200
    assert get_response.json()["title"] == "测试角色"
    
    # 3. Update: 更新角色
    update_data = {
        "title": "更新后的角色",
        "description": "更新后的描述"
    }
    
    update_response = await client.put(f"/api/v1/characters/{character_id}", json=update_data)
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "更新后的角色"
    assert update_response.json()["description"] == "更新后的描述"
    
    # 4. Delete: 删除角色
    delete_response = await client.delete(f"/api/v1/characters/{character_id}")
    assert delete_response.status_code == 200
    
    # 5. Verify: 验证已删除
    verify_response = await client.get(f"/api/v1/characters/{character_id}")
    assert verify_response.status_code == 404


@pytest.mark.asyncio
async def test_character_creation_validation(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession
):
    """测试角色创建验证（缺少必需字段）"""
    # Arrange: 准备模型
    provider_data = {
        "name": "Test Provider Validation",
        "api_url": "https://api.validation.com",
        "api_key": "validation-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Validation",
        "provider_id": provider_id,
        "model_name": "validation-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    model_id = model_response.json()["id"]
    
    # Act: 缺少必需的 title 字段
    invalid_data = {
        "description": "缺少 title 的角色",
        "model_id": model_id
        # ❌ 缺少 title 字段
    }
    
    response = await client.post("/api/v1/characters", json=invalid_data)
    
    # Assert: 应该返回 422 验证错误
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_shared_characters_endpoint(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession
):
    """测试共享角色获取"""
    # Arrange: 准备模型
    provider_data = {
        "name": "Test Provider Shared",
        "api_url": "https://api.shared.com",
        "api_key": "shared-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Shared",
        "provider_id": provider_id,
        "model_name": "shared-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    model_id = model_response.json()["id"]
    
    # 创建公开角色
    public_character_data = {
        "title": "公开角色",
        "description": "所有用户可见的角色",
        "model_id": model_id,
        "is_public": True
    }
    
    create_response = await client.post("/api/v1/characters", json=public_character_data)
    assert create_response.status_code == 200
    
    # Act: 获取共享角色列表
    shared_response = await client.get("/api/v1/shared/characters")
    
    # Assert
    assert shared_response.status_code == 200
    shared_characters = shared_response.json().get("items", [])
    # 至少包含刚创建的公开角色
    assert len(shared_characters) >= 1


@pytest.mark.asyncio
async def test_character_with_settings(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession
):
    """测试带设置的角色创建"""
    # Arrange
    provider_data = {
        "name": "Test Provider Settings",
        "api_url": "https://api.settings.com",
        "api_key": "settings-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Settings",
        "provider_id": provider_id,
        "model_name": "settings-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    model_id = model_response.json()["id"]
    
    # Act: 创建带设置的角色
    character_data = {
        "title": "带设置的角色",
        "description": "包含自定义设置",
        "model_id": model_id,
        "is_public": False,
        "settings": {
            "max_memory_length": 15,
            "system_prompt": "你是一个有帮助的助手"
        }
    }
    
    response = await client.post("/api/v1/characters", json=character_data)
    
    # Assert
    assert response.status_code == 200
    character_response = response.json()
    assert character_response["title"] == "带设置的角色"
    # 验证设置被保存
    assert character_response.get("settings") is not None


@pytest.mark.asyncio
async def test_session_with_character_integration(
    client: httpx.AsyncClient, 
    test_db_session: AsyncSession
):
    """测试会话与角色的完整集成"""
    # Arrange: 创建模型和角色
    provider_data = {
        "name": "Test Provider Integration",
        "api_url": "https://api.integration.com",
        "api_key": "integration-api-key"
    }
    
    provider_response = await client.post("/api/v1/providers", json=provider_data)
    provider_id = provider_response.json()["id"]
    
    model_data = {
        "name": "Test Model Integration",
        "provider_id": provider_id,
        "model_name": "integration-model",
        "model_type": "llm"
    }
    
    model_response = await client.post("/api/v1/models", json=model_data)
    model_id = model_response.json()["id"]
    
    character_data = {
        "title": "集成测试角色",
        "description": "用于会话集成测试",
        "model_id": model_id,
        "is_public": False
    }
    
    character_response = await client.post("/api/v1/characters", json=character_data)
    character_id = character_response.json()["id"]
    
    # Act 1: 使用角色创建会话（提供自定义 title）
    session_with_title_data = {
        "character_id": character_id,
        "model_id": model_id,
        "title": "自定义会话标题"
    }
    
    session1_response = await client.post("/api/v1/sessions", json=session_with_title_data)
    assert session1_response.status_code == 200
    assert session1_response.json()["title"] == "自定义会话标题"
    
    # Act 2: 使用角色创建会话（不提供 title，继承角色标题）
    session_without_title_data = {
        "character_id": character_id,
        "model_id": model_id
        # ❌ 不提供 title
    }
    
    session2_response = await client.post("/api/v1/sessions", json=session_without_title_data)
    assert session2_response.status_code == 200
    assert session2_response.json()["title"] == "集成测试角色"  # 继承角色标题
    
    # Cleanup: 删除会话
    await client.delete(f"/api/v1/sessions/{session1_response.json()['id']}")
    await client.delete(f"/api/v1/sessions/{session2_response.json()['id']}")
