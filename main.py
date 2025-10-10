import json
import os
import re
import time
import traceback
import uuid

# from werkzeug.utils import secure_filename

from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from ai_models import ai_models
from character_service import get_character_service
from chat_service import get_chat_service
from memory_strategy import MemoryStrategy
from message_service import get_message_service
from session_service import get_session_service
from summary_service import get_summary_service
from vector_memory import get_vector_memory
from vector_memory import get_vector_memory


session_service = get_session_service()
chat_service = get_chat_service()
message_service = get_message_service()
summary_service = get_summary_service()
character_service = get_character_service()
vector_memory = get_vector_memory()

# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)

os.chdir(current_directory)

print("当前脚本路径:", current_script_path)
print("当前脚本目录:", current_directory)
print("拼接后的文件路径:", os.path.join(current_directory, "web"))

app = Flask(__name__, static_folder=os.path.join(current_directory, "web"))
CORS(app, methods=["GET", "POST", "DELETE", "PUT"])


# 添加头像上传配置
UPLOAD_FOLDER = "web/uploads"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif"}
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# 确保上传目录存在
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


llm_models = ["qwen-plus-character"]


# 新增模型列表接口（使用实际SDK查询）
@app.route("/v1/models", methods=["GET"])
def get_all_models():
    return jsonify({"success": True, "data": {"models": ai_models}})


@app.route("/v1/sessions", methods=["GET"])
def get_sessions():
    return jsonify({"success": True, "data": {"items":session_service.get_all_sessions()}})


@app.route("/v1/sessions", methods=["POST"])
def create_or_get_sessions():
    try:
        character = character_service.get_character_by_id(request.json["character_id"])

        data = session_service.create_or_resume_session(
            user_id=request.json["user_id"],
            character_id=request.json["character_id"],
            name=character["title"],
        )
        if data is None:
            return jsonify(
                {"success": False, "error": "Failed to create or resume session."}
            )

        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/sessions/<session_id>", methods=["GET"])
def get_session(session_id):
    try:
        data = session_service.query_session(session_id=session_id)
        if len(data) == 0:
            return (
                jsonify(
                    {
                        "success": False,
                        "error": f"Session with ID {session_id} not found.",
                    }
                ),
                404,
            )
        if "memory_type" not in data[0] or data[0]["memory_type"] == "":
            data[0]["memory_type"] = "sliding_window"
        return jsonify({"success": True, "data": data[0]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/sessions/<session_id>", methods=["PUT"])
def update_session(session_id):
    try:
        session_service.update_session(session_id, request.json)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/sessions/<session_id>/messages", methods=["GET"])
def get_messages(session_id):
    try:
        messages = message_service.get_messages(session_id=session_id)
        return jsonify({"success": True, "data": {"items": messages}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/sessions/<session_id>/messages", methods=["DELETE"])
def clear_session_messages(session_id):
    try:
        message_service.delete_messages_by_session_id(session_id)
        summary_service.delete_summary_by_session_id(session_id)
        vector_memory.delete_session_memories(session_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/messages/<message_id>", methods=["DELETE"])
def delete_message(message_id):
    try:
        message_service.delete_message(message_id)
        vector_memory.delete_memory_by_message_id(message_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/messages/<message_id>", methods=["PUT"])
def update_message(message_id):
    try:
        message_service.update_message(message_id, {"content": request.json["content"]})
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/sessions/<session_id>/messages", methods=["POST"])
def add_message(session_id):
    try:

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
        )

        return jsonify({"success": True, "data": message})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/characters", methods=["GET"])
def get_characters():
    try:
        all_characters = character_service.get_all_characters()
        characters = [
            {
                "id": char.get("id"),
                "title": char.get("title"),
                "name": char.get("name"),
                "description": char.get("description"),
                "avatar_url": char.get("avatar_url"),
                "identity": char.get("identity"),
            }
            for char in all_characters
        ]
        return jsonify({"success": True, "data": {"items": characters}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/characters", methods=["POST"])
def create_characters():
    try:
        json_data = request.json
        character = {
            "title": json_data["title"] if "title" in json_data else "新建角色",
            "name": json_data["name"],
            "description": json_data["description"],
            "avatar_url": json_data["avatar_url"],
            "identity": json_data["identity"],
        }
        character_service.add_new_character(character)
        return jsonify({"success": True, "data": character})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/characters/<character_id>", methods=["DELETE"])
def delete_character(character_id):
    try:
        character_service.delete_character(character_id)

        sessions = session_service.query_session(character_id=character_id)
        for session in sessions:
            session_id = session["id"]
            session_service.delete_session(session_id=session_id)
            message_service.delete_messages_by_session_id(session_id=session_id)
            vector_memory.delete_session_memories(session_id=session_id)
            summary_service.delete_summary_by_session_id(session_id=session_id)

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/characters/<character_id>", methods=["PUT"])
def update_character(character_id):
    try:
        request_data = request.json

        data = {
            "title": request_data["title"],
            "name": request_data["name"],
            "identity": request_data["identity"],
        }

        if "detailed_setting" in request_data:
            data["detailed_setting"] = request_data["detailed_setting"]

        if "model" in request_data:
            data["model"] = request_data["model"]

        # 新增头像字段处理
        if "image" in request_data:
            data["image"] = request_data["image"]

        if "memory_type" in request_data:
            data["memory_type"] = request_data["memory_type"]

        character_service.update_character(character_id, data)

        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/v1/characters/<character_id>", methods=["GET"])
def get_character(character_id):
    try:
        character = character_service.get_character_by_id(character_id)
        return jsonify({"success": True, "data": character})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# 流式响应
def _generate_stream(
    session,
    character,
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
        metadata={},
    )
    try:
        yield f"data: {json.dumps({'message_id':message['id']})}\n\n"
        generator = chat_service.completions(
            session=session,
            character=character,
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
                "metadata": {
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
                character,
                user_message=user_message,
                assistant_message=message,
            )
        yield f"data: {json.dumps({'finish_reason':finish_reason,'error':finish_reason_error})}\n\n"
        yield "data: [DONE]\n\n"


@app.route("/v1/sessions/<session_id>/messages/stream", methods=["POST"])
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

        character = character_service.get_character_by_id(session["character_id"])
        strategy = chat_service.get_memory_strategy(session)
        active_messages = strategy.process_memory(
            session_id, character, current_message_id
        )
        return Response(
            _generate_stream(
                session,
                character,
                active_messages,
                strategy=strategy,
            ),
            mimetype="text/event-stream",
        )
    except Exception as e:
        print(e)
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})


# 新增头像上传接口
@app.route("/v1/characters/<character_id>/avatars", methods=["POST"])
def upload_avatar(character_id):
    try:
        # 检查是否有文件上传
        if "avatar" not in request.files:
            return jsonify({"success": False, "error": "没有上传文件"}), 400

        file = request.files["avatar"]

        # 检查文件名
        if file.filename == "":
            return jsonify({"success": False, "error": "未选择文件"}), 400

        # 检查文件类型
        if file and allowed_file(file.filename):
            # 生成安全的文件名
            # filename = secure_filename(file.filename)
            # 生成唯一文件名
            file_extension = file.filename.rsplit(".", 1)[1].lower()
            unique_filename = f"{character_id}.{file_extension}"
            # 保存文件
            file_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_filename)
            file.save(file_path)

            # 生成访问URL
            avatar_url = f"/web/uploads/{unique_filename}"
            character_service.update_character(character_id, {"avatar_url": avatar_url})
            return jsonify({"success": True, "data": {"url": avatar_url}})
        else:
            return jsonify({"success": False, "error": "不支持的文件类型"}), 400

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# 主对话循环
def main():
    app.run(host="0.0.0.0", port=5000, debug=True)


if __name__ == "__main__":
    main()
