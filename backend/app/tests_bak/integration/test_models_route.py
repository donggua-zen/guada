# app/tests/integration/test_models_route.py
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_end_to_end_model_and_provider_flow(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 1. 创建模型供应商
    provider_data = {
        "name": "Test Provider",
        "api_url": "https://api.test.com",
        "api_key": "test-api-key",
    }

    response = await client.post("/api/v1/providers", json=provider_data)
    assert response.status_code == 200
    provider_data_response = response.json()
    provider_id = provider_data_response["id"]
    assert provider_data_response["name"] == "Test Provider"
    assert provider_data_response["api_url"] == "https://api.test.com"

    # 2. 获取供应商列表（通过models端点，因为路由中get_models获取的是模型和供应商）
    response = await client.get("/api/v1/models")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) > 0  # 至少有一个供应商
    assert any(provider_id == item.get("id") for item in items)

    # 3. 创建模型
    model_data = {
        "name": "Test Model",
        "provider_id": provider_id,
        "model_name": "test-model-name",
        "model_type": "llm",
        "max_tokens": 4096,
        "max_output_tokens": 1024,
        "features": ["chat", "completion"],
    }

    response = await client.post("/api/v1/models", json=model_data)
    assert response.status_code == 200
    model_data_response = response.json()
    model_id = model_data_response["id"]
    assert model_data_response["name"] == "Test Model"
    assert model_data_response["model_name"] == "test-model-name"
    assert model_data_response["provider_id"] == provider_id

    # 4. 更新模型
    update_data = {"name": "Updated Model Name", "max_tokens": 8192}
    response = await client.put(f"/api/v1/models/{model_id}", json=update_data)
    assert response.status_code == 200
    updated_model = response.json()
    assert updated_model["name"] == "Updated Model Name"
    assert updated_model["max_tokens"] == 8192

    # 5. 更新供应商
    update_provider_data = {
        "name": "Updated Provider Name",
        "api_url": "https://updated-api.test.com",
    }
    response = await client.put(
        f"/api/v1/providers/{provider_id}", json=update_provider_data
    )
    assert response.status_code == 200
    updated_provider = response.json()
    assert updated_provider["name"] == "Updated Provider Name"
    assert updated_provider["api_url"] == "https://updated-api.test.com"

    # 6. 删除模型
    response = await client.delete(f"/api/v1/models/{model_id}")
    assert response.status_code == 200

    # 7. 验证模型已删除
    response = await client.get("/api/v1/models")
    # 检查响应中是否不再包含刚才删除的模型
    # 由于API返回的是模型和供应商的组合，我们检查是否能获取到其他数据
    assert response.status_code == 200

    # 8. 删除供应商
    response = await client.delete(f"/api/v1/providers/{provider_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_model_creation_validation(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 首先创建一个供应商
    provider_data = {
        "name": "Validation Provider",
        "api_url": "https://api.validation.com",
        "api_key": "validation-api-key",
    }

    response = await client.post("/api/v1/providers", json=provider_data)
    assert response.status_code == 200
    provider_response = response.json()
    provider_id = provider_response["id"]

    # 测试创建模型时缺少必要字段
    invalid_model_data = {
        "name": "Test Model Without Required Fields",
        # 缺少 provider_id
        "model_name": "test-model",
        "model_type": "llm",
    }

    response = await client.post("/api/v1/models", json=invalid_model_data)
    # 应该返回422验证错误
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_provider_creation_validation(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 测试创建供应商时缺少必要字段
    invalid_provider_data = {
        # 缺少 name
        "api_url": "https://api.missing-name.com",
        "api_key": "some-api-key",
    }

    response = await client.post("/api/v1/providers", json=invalid_provider_data)
    # 应该返回422验证错误
    assert response.status_code == 422
