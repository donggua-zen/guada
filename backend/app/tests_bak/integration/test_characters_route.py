# app/tests/integration/test_characters_route.py
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_end_to_end_character_flow(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 首先创建模型供应商
    provider_data = {
        "name": "Test Provider",
        "api_url": "https://api.test.com",
        "api_key": "test-api-key",
    }

    provider_response = await client.post("/api/v1/providers", json=provider_data)
    # 检查供应商创建是否成功
    assert provider_response.status_code in [200, 201]
    provider_data_response = provider_response.json()
    provider_id = provider_data_response["id"]

    # 然后创建模型
    model_data = {
        "name": "Test Model",
        "provider_id": provider_id,
        "model_name": "test-model-name",
        "model_type": "llm",
    }

    model_response = await client.post("/api/v1/models", json=model_data)
    # 检查模型创建是否成功
    assert model_response.status_code in [200, 201]
    model_data_response = model_response.json()
    model_id = model_data_response["id"]

    # 创建角色
    character_data = {
        "title": "Test Character",
        "description": "A test character for integration",
        "model_id": model_id,
        "is_public": False,
    }

    response = await client.post("/api/v1/characters", json=character_data)
    assert response.status_code == 200
    character_data_response = response.json()
    character_id = character_data_response["id"]
    assert character_data_response["title"] == "Test Character"
    assert character_data_response["description"] == "A test character for integration"

    # 获取角色列表
    response = await client.get("/api/v1/characters")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "Test Character"

    # 获取特定角色
    response = await client.get(f"/api/v1/characters/{character_id}")
    assert response.status_code == 200
    character = response.json()
    assert character["title"] == "Test Character"
    assert character["description"] == "A test character for integration"

    # 更新角色
    update_data = {"title": "Updated Character", "description": "Updated description"}
    response = await client.put(f"/api/v1/characters/{character_id}", json=update_data)
    assert response.status_code == 200
    updated_character = response.json()
    assert updated_character["title"] == "Updated Character"
    assert updated_character["description"] == "Updated description"

    # 删除角色
    response = await client.delete(f"/api/v1/characters/{character_id}")
    assert response.status_code == 200

    # 验证角色已删除
    response = await client.get("/api/v1/characters")
    assert response.json()["items"] == []


@pytest.mark.asyncio
async def test_character_creation_validation(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 首先创建模型供应商
    provider_data = {
        "name": "Test Provider Validation",
        "api_url": "https://api.validation.com",
        "api_key": "validation-api-key",
    }

    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_data_response = provider_response.json()
    provider_id = provider_data_response["id"]

    # 然后创建模型
    model_data = {
        "name": "Test Model Validation",
        "provider_id": provider_id,
        "model_name": "test-model-name-validation",
        "model_type": "llm",
    }

    model_response = await client.post("/api/v1/models", json=model_data)
    assert model_response.status_code in [200, 201]
    model_data_response = model_response.json()
    model_id = model_data_response["id"]

    # 测试缺少必要字段时的错误
    invalid_character_data = {
        "description": "A character without a title",
        "model_id": model_id,
        # 缺少必需的 title 字段
    }

    response = await client.post("/api/v1/characters", json=invalid_character_data)
    # 应该返回422验证错误
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_shared_characters(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 首先创建模型供应商
    provider_data = {
        "name": "Test Provider Shared",
        "api_url": "https://api.shared.com",
        "api_key": "shared-api-key",
    }

    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_data_response = provider_response.json()
    provider_id = provider_data_response["id"]

    # 然后创建模型
    model_data = {
        "name": "Test Model Shared",
        "provider_id": provider_id,
        "model_name": "test-model-name-shared",
        "model_type": "llm",
    }

    model_response = await client.post("/api/v1/models", json=model_data)
    assert model_response.status_code in [200, 201]
    model_data_response = model_response.json()
    model_id = model_data_response["id"]

    # 创建一个公开角色
    public_character_data = {
        "title": "Public Character",
        "description": "A public test character",
        "model_id": model_id,
        "is_public": True,
    }

    response = await client.post("/api/v1/characters", json=public_character_data)
    assert response.status_code == 200

    # 测试获取共享角色
    response = await client.get("/api/v1/shared/characters")
    assert response.status_code == 200
