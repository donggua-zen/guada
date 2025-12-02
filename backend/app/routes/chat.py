from contextlib import closing
import json
import logging
import traceback
from flask import Blueprint, Response, jsonify, request

from flask import stream_with_context
from flask_jwt_extended import jwt_required
from app.services import ChatService
from app.services import MessageService
from app.services import SessionService

message_service = MessageService()
chat_service = ChatService()

session_service = SessionService()

chat_bp = Blueprint("chat", __name__)
logger = logging.getLogger(__name__)


# 流式响应
@stream_with_context
def stream_generator(
    session_id: str,
    message_id: str,
    regeneration_mode: str,
    assistant_message_id: str = None,
):
    generator = None
    try:
        with closing(
            chat_service.completions(
                session_id,
                message_id,
                regeneration_mode=regeneration_mode,
                assistant_message_id=assistant_message_id,
            )
        ) as generator:
            # generator = chat_service.completions(
            #     session_id,
            #     message_id,
            #     regeneration_mode=regeneration_mode,
            #     assistant_message_id=assistant_message_id,
            # )
            logger.debug("Generator started.")
            for chunk in generator:
                json_chunk = json.dumps(chunk)
                yield f"data: {json_chunk}\n\n"
            yield "data: [DONE]\n\n"
            logger.debug("Generator ended.")
    except GeneratorExit:
        if generator is not None:
            generator.close()
        return
    except Exception as e:
        logger.debug(f"Exception2:{e}\n")
        traceback.print_exc()
        yield "data: [DONE]\n\n"


@chat_bp.route("/v1/sessions/<session_id>/messages/stream", methods=["POST"])
@jwt_required()
def chat_completions(session_id):
    try:
        data = request.json
        message_id = data.get("message_id")
        regeneration_mode = data.get("regeneration_mode", "overwrite") or "overwrite"
        assistant_message_id = data.get("assistant_message_id")

        if regeneration_mode not in ["overwrite", "multi_version", "append"]:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": "regeneration_mode must be one of overwrite, multi_version, append.",
                    }
                ),
                400,
            )

        return Response(
            stream_generator(
                session_id,
                message_id,
                regeneration_mode=regeneration_mode,
                assistant_message_id=assistant_message_id,
            ),
            mimetype="text/event-stream",
        )
    except Exception as e:
        logger.debug("chat_completions Exception:")
        logger.debug(e)
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 400


@chat_bp.route("/v1/sessions/<session_id>/tokens", methods=["GET"])
@jwt_required()
def get_tokens(session_id):
    data = chat_service.token_statistics(session_id)

    return jsonify(
        {
            "success": True,
            "data": data,
        }
    )


@chat_bp.route("/v1/messages/<message_id>/web_serach", methods=["GET"])
@jwt_required()
def web_search(message_id):
    try:
        data = chat_service.web_search(message_id)
        return jsonify(
            {
                "success": True,
                "data": data,
            }
        )
    except Exception as e:
        logger.debug("web_search Exception:")
        logger.debug(e)
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 400
