# app/tests/integration/test_sessions_route.py
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_end_to_end_session_flow(
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
    session_data = {"title": "Test Session", "model_id": model_id}

    response = await client.post("/api/v1/sessions", json=session_data)
    assert response.status_code == 200
    session_data_response = response.json()
    session_id = session_data_response["id"]
    assert session_data_response["title"] == "Test Session"

    # 获取会话列表
    response = await client.get("/api/v1/sessions")
    assert response.status_code == 200
    sessions = response.json()["items"]
    assert len(sessions) == 1
    assert sessions[0]["title"] == "Test Session"

    # 获取特定会话
    response = await client.get(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200
    session = response.json()
    assert session["title"] == "Test Session"

    # 更新会话
    update_data = {
        "title": "Updated Session Title",
        "description": "Updated description",
    }
    response = await client.put(f"/api/v1/sessions/{session_id}", json=update_data)
    assert response.status_code == 200
    updated_session = response.json()
    assert updated_session["title"] == "Updated Session Title"
    assert updated_session["description"] == "Updated description"

    # 添加消息到会话
    message_data = {"content": "Hello, this is a test message!", "files": []}

    response = await client.post(
        f"/api/v1/sessions/{session_id}/messages", json=message_data
    )
    assert response.status_code == 200
    message_response = response.json()
    message_id = message_response["id"]
    assert (
        message_response["contents"][0]["content"] == "Hello, this is a test message!"
    )

    # 获取会话中的消息
    response = await client.get(f"/api/v1/sessions/{session_id}/messages")
    assert response.status_code == 200
    messages = response.json()["items"]
    assert len(messages) == 1
    assert messages[0]["contents"][0]["content"] == "Hello, this is a test message!"

    # 删除消息
    response = await client.delete(f"/api/v1/messages/{message_id}")
    assert response.status_code == 200

    # 清空会话消息
    response = await client.delete(f"/api/v1/sessions/{session_id}/messages")
    assert response.status_code == 200

    # 验证消息已清空
    response = await client.get(f"/api/v1/sessions/{session_id}/messages")
    assert response.json()["items"] == []

    # 删除会话
    response = await client.delete(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200

    # 验证会话已删除
    response = await client.get("/api/v1/sessions")
    assert response.json()["items"] == []


@pytest.mark.asyncio
async def test_session_with_character(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    # 首先创建模型供应商
    provider_data = {
        "name": "Test Provider Character",
        "api_url": "https://api.test.com",
        "api_key": "test-api-key",
    }

    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_data_response = provider_response.json()
    provider_id = provider_data_response["id"]

    # 然后创建模型
    model_data = {
        "name": "Test Model Character",
        "provider_id": provider_id,
        "model_name": "test-model-name",
        "model_type": "llm",
    }

    model_response = await client.post("/api/v1/models", json=model_data)
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

    # 使用角色创建会话
    session_data = {
        "title": "Test Session with Character",
        "model_id": model_id,
        "character_id": character_id,
    }

    response = await client.post("/api/v1/sessions", json=session_data)
    assert response.status_code == 200
    session_data_response = response.json()
    session_id = session_data_response["id"]

    # 验证会话标题是否与角色标题一致
    assert session_data_response["title"] == character_data_response["title"]

    # 获取会话并验证是否包含角色信息
    response = await client.get(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200
    session = response.json()
    assert session["title"] == character_data_response["title"]
    # 如果API返回角色信息，可以在这里验证

    # 删除会话
    response = await client.delete(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200
