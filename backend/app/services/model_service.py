from app.models import db, Model, ModelProvider
from app.models.db_transaction import smart_transaction_manager


class ModelService:
    def __init__(self):
        pass

    def get_all_models(self):
        models = db.session.query(Model).all()
        return [
            {
                "id": m.id,
                "name": m.name,
                "provider_id": m.provider_id,
                "model_name": m.model_name,
                "model_type": m.model_type,
                "features": m.features,
                "max_tokens": m.max_tokens,
                "max_output_tokens": m.max_output_tokens,
            }
            for m in models
        ]

    def get_all_providers(self):
        providers = db.session.query(ModelProvider).all()
        return [
            {"id": p.id, "name": p.name, "api_key": p.api_key, "api_url": p.api_url}
            for p in providers
        ]

    def delete_model(self, model_id):
        model = db.session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise ValueError(f"Model with ID '{model_id}' not found.")

        with smart_transaction_manager.transaction():
            db.session.delete(model)

    def delete_provider(self, provider_id):
        provider = (
            db.session.query(ModelProvider)
            .filter(ModelProvider.id == provider_id)
            .first()
        )
        if not provider:
            raise ValueError(f"Provider with ID '{provider_id}' not found.")
        with smart_transaction_manager.transaction():
            db.session.delete(provider)
            db.session.delete_all(
                db.session.query(Model).filter(Model.provider_id == provider_id)
            )

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
        model = Model(
            model_name=model_name,
            model_type=model_type,
            name=name,
            provider_id=provider_id,
            features=features,
            max_tokens=max_tokens,
            max_output_tokens=max_output_tokens,
        )
        with smart_transaction_manager.transaction():
            db.session.add(model)
        return model.to_dict()

    def add_provider(self, name, api_key, api_url):
        provider = ModelProvider(
            name=name,
            api_key=api_key,
            api_url=api_url,
        )
        with smart_transaction_manager.transaction():
            db.session.add(provider)
        return provider.to_dict()

    def get_model(self, model_id):
        model = db.session.query(Model).filter(Model.id == model_id).first()
        if not model:
            return None
        provider = (
            db.session.query(ModelProvider)
            .filter(ModelProvider.id == model.provider_id)
            .first()
        )
        if not provider:
            return None

        return {
            "id": model.id,
            "model_name": model.model_name,
            "model_type": model.model_type,
            "name": model.name,
            "provider_id": model.provider_id,
            "features": model.features,
            "max_tokens": model.max_tokens,
            "max_output_tokens": model.max_output_tokens,
            "provider": {
                "id": provider.id,
                "name": provider.name,
                "api_key": provider.api_key,
                "api_url": provider.api_url,
            },
        }

    def update_model(self, model_id, data):
        model = db.session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise ValueError(f"Model with ID '{model_id}' not found.")
        with smart_transaction_manager.transaction():
            for key, value in data.items():
                setattr(model, key, value)
        return model.to_dict()

    def update_provider(self, provider_id, data):
        provider = (
            db.session.query(ModelProvider)
            .filter(ModelProvider.id == provider_id)
            .first()
        )
        if not provider:
            raise ValueError(f"Provider with ID '{provider_id}' not found.")
        with smart_transaction_manager.transaction():
            for key, value in data.items():
                setattr(provider, key, value)
        return provider.to_dict()

    def get_model_by_name(self, model_name, provider_name=None):
        model = None
        if provider_name:
            provider = (
                db.session.query(ModelProvider)
                .filter(ModelProvider.name == provider_name)
                .first()
            )
            if not provider:
                return None
            model = (
                db.session.query(Model)
                .filter(Model.model_name == model_name)
                .filter(Model.provider_id == provider.id)
                .first()
            )
        else:
            model = (
                db.session.query(Model).filter(Model.model_name == model_name).first()
            )

        if not model:
            return None
        return model.to_dict()

    def get_provider_by_name(self, provider_name):
        provider = (
            db.session.query(ModelProvider)
            .filter(ModelProvider.name == provider_name)
            .first()
        )
        if not provider:
            return None
        return provider.to_dict()