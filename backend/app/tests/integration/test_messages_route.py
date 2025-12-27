# app/tests/integration/test_messages_route.py
import pytest
import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import Session


@pytest.mark.asyncio
async def test_end_to_end_message_flow(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    from app.models.session import Session
    from app.models.message import Message

    # 1. 手动创建 Session（模拟前端已创建）
    session_id = "01HZZZZZZZZZZZZZZZZZZZZZZZZ"
    session = Session(
        id=session_id, user_id="test-user-ulid-00000000000000", title="Test Session"
    )
    test_db_session.add(session)
    await test_db_session.commit()

    # 2. 添加消息
    response = await client.post(
        f"/api/v1/sessions/{session_id}/messages",
        json={"content": "Hello, integration test!", "files": []},
    )
    assert response.status_code == 200
    msg_data = response.json()
    assert msg_data["contents"][0]["content"] == "Hello, integration test!"
    assert msg_data["session_id"] == session_id

    # 3. 获取消息列表
    response = await client.get(f"/api/v1/sessions/{session_id}/messages")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["contents"][0]["content"] == "Hello, integration test!"

    # 4. 删除消息
    message_id = msg_data["id"]
    response = await client.delete(f"/api/v1/messages/{message_id}")
    assert response.status_code == 200

    # 5. 验证消息已删除
    response = await client.get(f"/api/v1/sessions/{session_id}/messages")
    assert response.json()["items"] == []


@pytest.mark.asyncio
async def test_clear_all_messages(
    client: httpx.AsyncClient, test_db_session: AsyncSession
):
    from app.models.session import Session

    session_id = "01HYYYYYYYYYYYYYYYYYYYYYYYY"

    # 创建 session
    session = Session(
        id=session_id, user_id="test-user-ulid-00000000000000", title="Clear Test"
    )
    test_db_session.add(session)
    await test_db_session.commit()

    # 添加多条消息
    for i in range(3):
        resp = await client.post(
            f"/api/v1/sessions/{session_id}/messages",
            json={"content": f"Message {i}", "files": []},
        )
        assert resp.status_code == 200

    # 清空
    resp = await client.delete(f"/api/v1/sessions/{session_id}/messages")
    assert resp.status_code == 200

    # 验证
    resp = await client.get(f"/api/v1/sessions/{session_id}/messages")
    assert resp.json()["size"] == 0
