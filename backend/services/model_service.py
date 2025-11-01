from models import Model, ModelProvider, SessionLocal


class _ModelService:
    def __init__(self):
        self.db_session = SessionLocal()

    def get_all_models(self):
        models = self.db_session.query(Model).all()
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
        providers = self.db_session.query(ModelProvider).all()
        return [
            {"id": p.id, "name": p.name, "api_key": p.api_key, "api_url": p.api_url}
            for p in providers
        ]

    def delete_model(self, model_id):
        model = self.db_session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise ValueError(f"Model with ID '{model_id}' not found.")
        self.db_session.delete(model)
        self.db_session.commit()

    def delete_provider(self, provider_id):
        provider = (
            self.db_session.query(ModelProvider)
            .filter(ModelProvider.id == provider_id)
            .first()
        )
        if not provider:
            raise ValueError(f"Provider with ID '{provider_id}' not found.")
        self.db_session.delete(provider)
        self.db_session.delete_all(
            self.db_session.query(Model).filter(Model.provider_id == provider_id)
        )
        self.db_session.commit()

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

        self.db_session.add(model)
        self.db_session.commit()
        return {
            "id": model.id,
            "model_name": model.model_name,
            "model_type": model.model_type,
            "name": model.name,
            "provider_id": model.provider_id,
            "features": model.features,
            "max_tokens": model.max_tokens,
            "max_output_tokens": model.max_output_tokens,
        }

    def add_provider(self, name, api_key, api_url):
        provider = ModelProvider(
            name=name,
            api_key=api_key,
            api_url=api_url,
        )
        self.db_session.add(provider)
        self.db_session.commit()
        return {
            "id": provider.id,
            "name": provider.name,
            "api_key": provider.api_key,
            "api_url": provider.api_url,
        }

    def get_model(self, model_id):
        model = self.db_session.query(Model).filter(Model.id == model_id).first()
        if not model:
            return None
        provider = (
            self.db_session.query(ModelProvider)
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
        model = self.db_session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise ValueError(f"Model with ID '{model_id}' not found.")
        for key, value in data.items():
            setattr(model, key, value)
        self.db_session.commit()
        return {
            "id": model.id,
            "model_name": model.model_name,
            "model_type": model.model_type,
            "name": model.name,
            "provider_id": model.provider_id,
            "features": model.features,
            "max_tokens": model.max_tokens,
            "max_output_tokens": model.max_output_tokens,
        }

    def update_provider(self, provider_id, data):
        provider = (
            self.db_session.query(ModelProvider)
            .filter(ModelProvider.id == provider_id)
            .first()
        )
        if not provider:
            raise ValueError(f"Provider with ID '{provider_id}' not found.")
        for key, value in data.items():
            setattr(provider, key, value)
        self.db_session.commit()
        return {
            "id": provider.id,
            "name": provider.name,
            "api_key": provider.api_key,
            "api_url": provider.api_url,
        }


_modelService = _ModelService()


def get_model_service() -> _ModelService:
    return _modelService
