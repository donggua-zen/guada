from app.models import db, Model, ModelProvider
from app.models.db_transaction import smart_transaction_manager
from app.repositories.model_repository import ModelRepository as ModelRepo


class ModelService:
    def __init__(self):
        pass

    def get_all_models(self):
        models = ModelRepo.get_all_models()
        return models

    def get_all_providers(self):
        providers = ModelRepo.get_all_providers()
        return providers

    def delete_model(self, model_id):
        if not ModelRepo.delete_model(model_id):
            raise ValueError(f"Model with ID '{model_id}' not found.")

    def delete_provider(self, provider_id):
        ModelRepo.delete_provider(provider_id)

    def add_model(
        self,
        model_name,
        model_type,
        provider_id,
        name=None,
        features=None,
        max_tokens: int = None,
        max_output_tokens: int = None,
    ):
        model = ModelRepo.add_model(
            model_name=model_name,
            model_type=model_type,
            name=name,
            provider_id=provider_id,
            features=features,
            max_tokens=max_tokens,
            max_output_tokens=max_output_tokens,
        )
        return model

    def add_provider(self, name, api_key, api_url):
        provider = ModelRepo.add_provider(
            name=name,
            api_key=api_key,
            api_url=api_url,
        )
        return provider

    def get_model(self, model_id):
        model = ModelRepo.get_model(model_id)
        if not model:
            raise ValueError(f"Model with ID '{model_id}' not found.")
        return model

    def update_model(self, model_id, data):
        model = ModelRepo.update_model(model_id, data)
        return model

    def update_provider(self, provider_id, data):
        provider = ModelRepo.update_provider(provider_id, data)
        return provider

    def get_model_by_name(self, model_name, provider_name=None):
        model = ModelRepo.get_model_by_name(model_name, provider_name)
        if not model:
            raise ValueError(f"Model with name '{model_name}' not found.")
        return model

    def get_provider_by_name(self, provider_name):
        provider = ModelRepo.get_provider_by_name(provider_name)
        if not provider:
            raise ValueError(f"Provider with name '{provider_name}' not found.")
        return provider
