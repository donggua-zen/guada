from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.services import ModelService
from app.utils.decorators import handle_exceptions


models_bp = Blueprint("models", __name__)

model_service = ModelService()
# 模型相关


@models_bp.route("/api/v1/models", methods=["GET"])
@jwt_required()
@handle_exceptions
def get_models():
    user_id = get_jwt_identity()
    models = model_service.get_models_and_providers(user_id=user_id)
    return jsonify(
        {
            "success": True,
            "data": models,
        }
    )


@models_bp.route("/api/v1/models/<model_id>", methods=["DELETE"])
@jwt_required()
@handle_exceptions
def delete_model(model_id):
    model_service.delete_model(model_id)
    return jsonify({"success": True})


@models_bp.route("/api/v1/models", methods=["POST"])
@jwt_required()
@handle_exceptions
def create_model():
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


@models_bp.route("/api/v1/models/<model_id>", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_model(model_id):
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


@models_bp.route("/api/v1/providers", methods=["POST"])
@jwt_required()
@handle_exceptions
def create_provider():
    request_data = request.json
    user_id = get_jwt_identity()
    fields = [
        "name",
        "api_key",
        "api_url",
    ]
    data = {field: request_data.get(field) for field in fields}
    data = model_service.add_provider(user_id=user_id, **data)
    return jsonify({"success": True, "data": data})


@models_bp.route("/api/v1/providers/<provider_id>", methods=["PUT"])
@jwt_required()
@handle_exceptions
def update_provider(provider_id):
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


@models_bp.route("/api/v1/providers/<provider_id>", methods=["DELETE"])
@jwt_required()
@handle_exceptions
def delete_provider(provider_id):
    model_service.delete_provider(provider_id)
    return jsonify({"success": True})
