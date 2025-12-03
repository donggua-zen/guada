import datetime
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.services import ModelService


models_bp = Blueprint("models", __name__)

model_service = ModelService()
# 模型相关


@models_bp.route("/api/v1/models", methods=["GET"])
@jwt_required()
def get_models():
    try:
        user_id = get_jwt_identity()
        models = model_service.get_models_and_providers(user_id=user_id)
        return jsonify(
            {
                "success": True,
                "data": models,
            }
        )
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@models_bp.route("/api/v1/models/<model_id>", methods=["DELETE"])
@jwt_required()
def delete_model(model_id):
    try:
        model_service.delete_model(model_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@models_bp.route("/api/v1/models", methods=["POST"])
@jwt_required()
def create_model():
    try:
        request_data = request.json
        fields = [
            "model_name",
            "model_type",
            "provider_id",
            "name",
            "features",
            "max_tokens",
            "max_output_tokens",
        ]
        data = {field: request_data.get(field) for field in fields}
        data = model_service.add_model(**data)
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@models_bp.route("/api/v1/models/<model_id>", methods=["PUT"])
@jwt_required()
def update_model(model_id):
    try:
        request_data = request.json
        fields = [
            "model_name",
            "model_type",
            "name",
            "features",
            "max_tokens",
            "max_output_tokens",
        ]
        data = {field: request_data.get(field) for field in fields}
        data = model_service.update_model(model_id, data)
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# @models_bp.route("/api/v1/providers", methods=["DELETE"])
# def delete_provider(provider_id):
#     try:
#         model_service.delete_provider(provider_id)
#         return jsonify({"success": True})
#     except Exception as e:
#         return jsonify({"success": False, "error": str(e)}), 500


@models_bp.route("/api/v1/providers", methods=["POST"])
@jwt_required()
def create_provider():
    try:
        request_data = request.json
        fields = [
            "name",
            "api_key",
            "api_url",
        ]
        data = {field: request_data.get(field) for field in fields}
        data = model_service.add_provider(**data)
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@models_bp.route("/api/v1/providers/<provider_id>", methods=["PUT"])
@jwt_required()
def update_provider(provider_id):
    try:
        request_data = request.json
        fields = [
            "provider_id",
            "name",
            "api_key",
            "api_url",
        ]
        data = {field: request_data.get(field) for field in fields}
        model_service.update_provider(provider_id, data)
        return jsonify({"success": True, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@models_bp.route("/api/v1/providers/<provider_id>", methods=["DELETE"])
@jwt_required()
def delete_provider(provider_id):
    try:
        model_service.delete_provider(provider_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
