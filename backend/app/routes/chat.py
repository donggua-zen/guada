import datetime
import json
import traceback
from flask import Blueprint, Response, jsonify, request

from flask import stream_with_context
from app.services import ChatService
from app.services import MessageService
from app.services import SessionService

message_service = MessageService()
chat_service = ChatService()

session_service = SessionService()

chat_bp = Blueprint("chat", __name__)


# 流式响应
@stream_with_context
def stream_generator(
    session_id: str,
    message_id: str,
):
    generator = None
    try:
        generator = chat_service.completions(
            session_id,
            message_id,
        )
        print("Generator started.")
        for chunk in generator:
            json_chunk = json.dumps(chunk)
            yield f"data: {json_chunk}\n\n"
        print("Generator ended.")
    except GeneratorExit:
        if generator is not None:
            generator.close()
        print("Generator exited.")
        raise  # 必须重新抛出异常
    except Exception as e:
        print(f"Exception2:{e}\n")
        traceback.print_exc()
    finally:
        yield "data: [DONE]\n\n"


@chat_bp.route("/v1/sessions/<session_id>/messages/stream", methods=["POST"])
def chat_completions(session_id):
    try:
        data = request.json
        message_id = data["message"]["message_id"]

        return Response(
            stream_generator(session_id, message_id),
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
    summary_tokens = 0

    context_messages = chat_service.construct_context_message(session, active_messages)

    for i, message in enumerate(context_messages):
        if message["role"] == "system":
            if i == 0:  # 第一个系统提示语
                system_prompt_tokens += tokenizer.count_tokens(message["content"])
            else:  # 其他系统提示词一般是摘要和召回记录
                summary_tokens += tokenizer.count_tokens(message["content"])
        else:
            context_tokens += tokenizer.count_tokens(message["content"])

    max_memory_length = system_prompt_tokens + summary_tokens + context_tokens
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
                "summary_tokens": summary_tokens,
                "context_tokens": context_tokens,
            },
        }
    )
