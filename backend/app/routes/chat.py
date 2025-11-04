import datetime
import json
import traceback
from flask import Blueprint, Response, jsonify, request

from flask import stream_with_context
from app.services import ChatService
from app.services import MemoryStrategy
from app.services import MessageService
from app.services import SessionService

chat_service = ChatService()
message_service = MessageService()
session_service = SessionService()

chat_bp = Blueprint("chat", __name__)


# 流式响应
@stream_with_context
def stream_generator(
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


def get_memory_strategy(session: dict) -> MemoryStrategy:
    """
    根据角色配置获取记忆策略实例

    Args:
        character: 角色信息

    Returns:
        记忆策略实例
    """
    from app.services.memory_strategy import (
        MemorylessStrategy,
        SlidingWindowStrategy,
        SummaryAugmentedSlidingWindowStrategy,
        SlidingWindowWithRAGStrategy,
    )

    memory_type = session.get("memory_type", "sliding_window")
    if memory_type == "sliding_window":
        return SlidingWindowStrategy()
    elif memory_type == "summary_augmented_sliding_window":
        return SummaryAugmentedSlidingWindowStrategy()
    elif memory_type == "sliding_window_with_rag":
        return SlidingWindowWithRAGStrategy()
    else:
        return MemorylessStrategy()


@chat_bp.route("/v1/sessions/<session_id>/messages/stream", methods=["POST"])
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
        strategy = get_memory_strategy(session)
        active_messages = strategy.process_memory(session, current_message_id)
        return Response(
            stream_generator(
                session,
                active_messages,
                strategy=strategy,
            ),
            mimetype="text/event-stream",
        )
    except Exception as e:
        print("chat_completions Exception:")
        print(e)
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 400


from app.tokenizer.auto_tokenizer import get_tokenizer


@chat_bp.route("/v1/sessions/<session_id>/tokens", methods=["GET"])
def get_tokens(session_id):
    from app.services.model_service import ModelService

    model_service = ModelService()
    session = session_service.get_session_by_id(session_id=session_id)
    strategy = get_memory_strategy(session)

    settings = session["settings"]
    model = model_service.get_model(model_id=settings["model_id"])

    active_messages = strategy.process_memory(session, current_message_id=None)
    tokenizer = get_tokenizer(model["model_name"])

    system_prompt_tokens = 0
    context_tokens = 0

    context_messages = chat_service.construct_context_message(session, active_messages)

    for message in context_messages:
        if message["role"] == "system":
            system_prompt_tokens += tokenizer.count_tokens(message["content"])
        else:
            context_tokens += tokenizer.count_tokens(message["content"])

    max_memory_length = system_prompt_tokens + context_tokens
    # 简化写法：使用get方法设置默认值
    max_memory_length = (
        settings.get("max_memory_length", max_memory_length) or max_memory_length
    )

    return jsonify(
        {
            "success": True,
            "data": {
                "max_memory_length": max_memory_length,
                "system_prompt_tokens": system_prompt_tokens,
                "context_tokens": context_tokens,
            },
        }
    )
