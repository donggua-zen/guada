import datetime
import json
import traceback
from flask import Blueprint, Response, jsonify, request
from services import summary_service
from services import message_service
from services import session_service
from services import vector_memory
from services import chat_service
from services.memory_strategy import MemoryStrategy


messages_bp = Blueprint("messages", __name__)


@messages_bp.route("/v1/sessions/<session_id>/messages", methods=["GET"])
def get_messages(session_id):
    try:
        messages = message_service.get_messages(session_id=session_id)
        return jsonify({"success": True, "data": {"items": messages}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/sessions/<session_id>/messages", methods=["DELETE"])
def clear_session_messages(session_id):
    try:
        message_service.delete_messages_by_session_id(session_id)
        summary_service.delete_summary_by_session_id(session_id)
        vector_memory.delete_session_memories(session_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/messages/<message_id>", methods=["DELETE"])
def delete_message(message_id):
    try:
        message_service.delete_message(message_id)
        vector_memory.delete_memory_by_message_id(message_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/messages/<message_id>", methods=["PUT"])
def update_message(message_id):
    try:
        message_service.update_message(message_id, {"content": request.json["content"]})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@messages_bp.route("/v1/sessions/<session_id>/messages", methods=["POST"])
def add_message(session_id):
    try:
        session = session_service.get_session_by_id(session_id)
        # 获取会话最后一条消息
        last_message = message_service.get_messages(
            session_id=session_id, order_type="desc", last_n_messages=1
        )

        # 添加新消息到完整历史
        message = message_service.add_message(
            session_id=session_id,
            role="user",
            content=request.json["content"],
            parent_id=last_message[0]["id"] if last_message else None,
            token_count=0,
        )

        return jsonify({"success": True, "data": message})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# 流式响应
def _generate_stream(
    session,
    active_messages,
    strategy: MemoryStrategy = None,
):
    generator = None

    finish_reason = None
    finish_reason_error = None
    reasoning_content = ""
    content = ""
    message = message_service.add_message(
        session_id=session["id"],
        role="assistant",
        content="",
        parent_id=active_messages[-1]["id"] if active_messages else None,
        reasoning_content="",
        meta_data={},
    )
    try:
        yield f"data: {json.dumps({'message_id':message['id']})}\n\n"
        generator = chat_service.completions(
            session=session,
            messages=active_messages,
        )
        for chunk in generator:
            response_chunk = {
                "content": None,
                "reasoning_content": None,
            }
            if chunk.finish_reason is not None:
                finish_reason = chunk.finish_reason
                # response_chunk["finish_reason"] = chunk.finish_reason
                break
            elif chunk.content is not None:
                response_chunk["content"] = chunk.content
                content += chunk.content
            elif chunk.reasoning_content is not None:
                response_chunk["reasoning_content"] = chunk.reasoning_content
                reasoning_content += chunk.reasoning_content
            else:
                continue
            yield f"data: {json.dumps(response_chunk)}\n\n"

    except GeneratorExit:
        if generator is not None:
            generator.close()
            print("Generator exited.")
    except Exception as e:
        print(f"Exception2:{e}\n")
        traceback.print_exc()
        finish_reason = "error"
        finish_reason_error = str(e)
        # yield f"data: {json.dumps({'finish_reason':'error','error': str(e)})}\n\n"
    finally:

        message_service.update_message(
            message["id"],
            data={
                "content": content,
                "reasoning_content": reasoning_content,
                "meta_data": {
                    "finish_reason": finish_reason,
                    "error": finish_reason_error,
                },
            },
        )

        # 使用策略处理对话后的记忆
        user_message = active_messages[-1] if active_messages else None
        if user_message and strategy:
            strategy.post_process_memory(
                session["id"],
                user_message=user_message,
                assistant_message=message,
            )
        yield f"data: {json.dumps({'finish_reason':finish_reason,'error':finish_reason_error})}\n\n"
        yield "data: [DONE]\n\n"


@messages_bp.route("/v1/sessions/<session_id>/messages/stream", methods=["POST"])
def chat_completions(session_id):
    try:
        data = request.json
        message_id = data["message"]["message_id"]
        current_message_id = message_id

        session = session_service.get_session_by_id(session_id=session_id)

        if session is None:
            return jsonify(
                {"success": False, "error": f"Session with ID {session_id} not found."}
            )

        session_service.update_session(
            session_id,
            data={
                "updated_at": datetime.datetime.now(datetime.timezone.utc),
            },
        )
        # character = character_service.get_character_by_id(session["character_id"])
        strategy = chat_service.get_memory_strategy(session)
        active_messages = strategy.process_memory(session, current_message_id)
        return Response(
            _generate_stream(
                session,
                active_messages,
                strategy=strategy,
            ),
            mimetype="text/event-stream",
        )
    except Exception as e:
        print(e)
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})
