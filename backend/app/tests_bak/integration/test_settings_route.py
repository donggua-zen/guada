# app/tests/integration/test_settings_route.py
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_settings_operations(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 获取当前用户设置
    response = await client.get("/api/v1/settings")
    assert response.status_code == 200
    settings_data = response.json()
    # 验证响应结构
    assert "search_prompt_context_length" in settings_data

    # 更新用户设置
    update_data = {"search_prompt_context_length": 10}

    response = await client.put("/api/v1/settings", json=update_data)
    assert response.status_code in [200, 201, 400, 422]

    # 获取更新后的设置
    response = await client.get("/api/v1/settings")
    assert response.status_code == 200
    updated_settings = response.json()
    # 检查是否更新成功
    assert updated_settings["search_prompt_context_length"] == 10


@pytest.mark.asyncio
async def test_settings_with_user_context(
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

    # 创建会话
    session_data = {
        "title": "Test Session for Settings",
        "model_id": model_id,
        "settings": {
            "assistant_name": "Test Assistant",
            "assistant_identity": "A helpful assistant",
            "system_prompt": "You are a helpful assistant.",
            "model_temperature": 0.7,
        },
    }

    response = await client.post("/api/v1/sessions", json=session_data)
    assert response.status_code == 200
    session_data_response = response.json()
    session_id = session_data_response["id"]
    assert session_data_response["title"] == "Test Session for Settings"

    # 获取会话并验证设置
    response = await client.get(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200
    session = response.json()
    if "settings" in session:
        session_settings = session["settings"]
        assert session_settings.get("assistant_name") == "Test Assistant"

    # 更新会话设置
    update_session_data = {
        "title": "Updated Session for Settings",
        "settings": {
            "assistant_name": "Updated Assistant",
            "assistant_identity": "An updated helpful assistant",
            "system_prompt": "You are an updated helpful assistant.",
            "model_temperature": 0.8,
        },
    }

    response = await client.put(
        f"/api/v1/sessions/{session_id}", json=update_session_data
    )
    assert response.status_code == 200
    updated_session = response.json()
    assert updated_session["title"] == "Updated Session for Settings"
    if "settings" in updated_session:
        updated_settings = updated_session["settings"]
        assert updated_settings.get("assistant_name") == "Updated Assistant"

    # 删除会话
    response = await client.delete(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200

    # 再次测试全局设置
    # 获取当前用户设置
    response = await client.get("/api/v1/settings")
    assert response.status_code == 200

    # 更新全局设置
    update_global_data = {
        "data": {
            "last_used_model": model_id,
            "default_session_settings": {"model_temperature": 0.5, "model_top_p": 0.9},
        }
    }

    response = await client.put("/api/v1/settings", json=update_global_data)
    assert response.status_code in [200, 201]
