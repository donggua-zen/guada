from app.models import db, Model, ModelProvider
from app.models.db_transaction import execute_in_transaction


class ModelRepository:
    @staticmethod
    def get_models():
        models = db.session.query(Model).all()
        return models

    @staticmethod
    def get_providers():
        providers = db.session.query(ModelProvider).all()
        return providers

    @staticmethod
    def get_provider(provider_id):
        return (
            db.session.query(ModelProvider)
            .filter(ModelProvider.id == provider_id)
            .first()
        )

    @staticmethod
    def get_providers_with_models(user_id):
        """
        获取指定用户的所有模型提供商及其关联的模型信息

        Args:
            user_id: 用户ID，用于筛选特定用户的模型提供商

        Returns:
            list: 包含模型提供商及其关联模型信息的字典列表，每个元素都是
                  ModelProvider对象调用to_dict方法并包含models字段的结果
        """
        providers = (
            db.session.query(ModelProvider)
            .filter(ModelProvider.user_id == user_id)
            .options(db.selectinload(ModelProvider.models))
            .all()
        )
        return providers

    @staticmethod
    @execute_in_transaction
    def delete_model(model_id):
        return db.session.query(Model).filter(Model.id == model_id).delete()

    @staticmethod
    @execute_in_transaction
    def delete_provider(provider_id):
        return (
            db.session.query(ModelProvider)
            .filter(ModelProvider.id == provider_id)
            .delete()
        )

    @staticmethod
    @execute_in_transaction
    def add_model(
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
        db.session.add(model)
        return model

    @staticmethod
    @execute_in_transaction
    def add_provider(name, user_id, api_key, api_url):
        provider = ModelProvider(
            user_id=user_id,
            name=name,
            api_key=api_key,
            api_url=api_url,
        )
        db.session.add(provider)
        return provider

    @staticmethod
    def get_model(model_id):
        return db.session.query(Model).filter(Model.id == model_id).first()

    @staticmethod
    @execute_in_transaction
    def update_model(model_id, data):
        model = db.session.query(Model).filter(Model.id == model_id).first()
        if not model:
            raise ValueError(f"Model with ID '{model_id}' not found.")
        for key, value in data.items():
            setattr(model, key, value)
        return model

    @staticmethod
    @execute_in_transaction
    def update_provider(provider_id, data):
        provider = (
            db.session.query(ModelProvider)
            .filter(ModelProvider.id == provider_id)
            .first()
        )
        if not provider:
            raise ValueError(f"Provider with ID '{provider_id}' not found.")
        for key, value in data.items():
            setattr(provider, key, value)
        return provider

    @staticmethod
    def get_model_by_name(model_name, provider_name=None):
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

        return model

    @staticmethod
    def get_provider_by_name(provider_name):
        provider = (
            db.session.query(ModelProvider)
            .filter(ModelProvider.name == provider_name)
            .first()
        )
        return provider
