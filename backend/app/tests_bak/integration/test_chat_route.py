# app/tests/integration/test_chat_route.py
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_end_to_end_chat_flow(
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
    session_data = {"title": "Test Chat Session", "model_id": model_id}

    response = await client.post("/api/v1/sessions", json=session_data)
    assert response.status_code == 200
    session_data_response = response.json()
    session_id = session_data_response["id"]
    assert session_data_response["title"] == "Test Chat Session"

    # 发送消息
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

    # 重新生成消息
    # regenerate_data = {
    #     "mode": "regenerate",
    #     "message_id": message_id
    # }

    # response = await client.post(
    #     f"/api/v1/sessions/{session_id}/regenerate",
    #     json=regenerate_data
    # )
    # # 可能会返回错误，因为可能没有实际的AI服务来处理请求
    # # 但我们至少可以测试API是否正确接收请求
    # assert response.status_code in [200, 400, 500]

    # 删除消息
    response = await client.delete(f"/api/v1/messages/{message_id}")
    assert response.status_code == 200

    # 删除会话
    response = await client.delete(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_chat_session_with_character(
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

    # 使用角色创建会话（提供自定义 title）
    session_data = {
        "title": "Custom Session Title",  # ✅ 提供自定义标题
        "model_id": model_id,
        "character_id": character_id,
    }

    response = await client.post("/api/v1/sessions", json=session_data)
    assert response.status_code == 200
    session_data_response = response.json()
    session_id = session_data_response["id"]
    
    # ✅ 业务逻辑确认：如果参数提供 title，优先使用参数的
    assert session_data_response["title"] == "Custom Session Title"
    
    # 发送消息到会话
    message_data = {"content": "Hello, character!", "files": []}

    response = await client.post(
        f"/api/v1/sessions/{session_id}/messages", json=message_data
    )
    assert response.status_code == 200
    message_response = response.json()
    assert message_response["contents"][0]["content"] == "Hello, character!"

    # 删除会话
    response = await client.delete(f"/api/v1/sessions/{session_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_session_title_inheritance_from_character(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    """测试会话标题继承逻辑：不提供 title 时继承角色标题
    
    业务规则:
    1. 如果参数提供 title，优先使用参数的
    2. 如果参数未提供 title，则继承角色的标题
    """
    # 首先创建模型供应商
    provider_data = {
        "name": "Test Provider Inheritance",
        "api_url": "https://api.test.com",
        "api_key": "test-api-key",
    }

    provider_response = await client.post("/api/v1/providers", json=provider_data)
    assert provider_response.status_code in [200, 201]
    provider_data_response = provider_response.json()
    provider_id = provider_data_response["id"]

    # 然后创建模型
    model_data = {
        "name": "Test Model Inheritance",
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
        "title": "Inherited Character Title",
        "description": "A test character for title inheritance",
        "model_id": model_id,
        "is_public": False,
    }

    response = await client.post("/api/v1/characters", json=character_data)
    assert response.status_code == 200
    character_data_response = response.json()
    character_id = character_data_response["id"]
    assert character_data_response["title"] == "Inherited Character Title"

    # 使用角色创建会话（不提供 title，验证继承）
    session_data = {
        "model_id": model_id,
        "character_id": character_id,
        # ✅ 不提供 title 字段，应该继承角色标题
    }

    response = await client.post("/api/v1/sessions", json=session_data)
    assert response.status_code == 200
    session_data_response = response.json()
    session_id = session_data_response["id"]
    
    # ✅ 业务逻辑确认：不提供 title 时继承角色标题
    assert session_data_response["title"] == "Inherited Character Title"
