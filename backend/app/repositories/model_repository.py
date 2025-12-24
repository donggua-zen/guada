from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from app.models.model import Model
from app.models.model_provider import ModelProvider


class ModelRepository:
    def __init__(self, session: AsyncSession):
        """
        初始化ModelRepository
        :param session: 异步数据库会话
        """
        self.session = session

    async def get_models(self):
        stmt = select(Model)
        result = await self.session.execute(stmt)
        models = result.scalars().all()
        return models

    async def get_providers(self):
        stmt = select(ModelProvider)
        result = await self.session.execute(stmt)
        providers = result.scalars().all()
        return providers

    async def get_provider(self, provider_id):
        stmt = select(ModelProvider).filter(ModelProvider.id == provider_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_providers_with_models(self, user_id):
        """
        获取指定用户的所有模型提供商及其关联的模型信息

        Args:
            user_id: 用户ID，用于筛选特定用户的模型提供商

        Returns:
            list: 包含模型提供商及其关联模型信息的字典列表，每个元素都是
                  ModelProvider对象调用to_dict方法并包含models字段的结果
        """
        stmt = (
            select(ModelProvider)
            .filter(ModelProvider.user_id == user_id)
            .options(selectinload(ModelProvider.models))
        )
        result = await self.session.execute(stmt)
        providers = result.scalars().all()
        return providers

    async def delete_model(self, model_id):
        stmt = delete(Model).where(Model.id == model_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def delete_provider(self, provider_id):
        stmt = delete(ModelProvider).where(ModelProvider.id == provider_id)
        result = await self.session.execute(stmt)
        return result.rowcount > 0

    async def add_model(
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
        self.session.add(model)
        await self.session.flush()
        return await self.get_model(model.id)

    async def add_provider(self, name, user_id, api_key, api_url):
        provider = ModelProvider(
            user_id=user_id,
            name=name,
            api_key=api_key,
            api_url=api_url,
        )
        self.session.add(provider)
        await self.session.flush()
        stmt = select(ModelProvider).filter(ModelProvider.id == provider.id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_model(self, model_id):
        stmt = select(Model).filter(Model.id == model_id)
        stmt = stmt.options(selectinload(Model.provider))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def update_model(self, model_id, data):
        stmt = select(Model).filter(Model.id == model_id)
        result = await self.session.execute(stmt)
        model = result.scalar_one_or_none()
        if not model:
            raise ValueError(f"Model with ID '{model_id}' not found.")
        for key, value in data.items():
            setattr(model, key, value)
        return model

    async def update_provider(self, provider_id, data):
        stmt = select(ModelProvider).filter(ModelProvider.id == provider_id)
        result = await self.session.execute(stmt)
        provider = result.scalar_one_or_none()
        if not provider:
            raise ValueError(f"Provider with ID '{provider_id}' not found.")
        for key, value in data.items():
            setattr(provider, key, value)
        return provider

    async def get_model_by_name(self, model_name, provider_name=None):
        if provider_name:
            stmt = select(ModelProvider).filter(ModelProvider.name == provider_name)
            result = await self.session.execute(stmt)
            provider = result.scalar_one_or_none()
            if not provider:
                return None
            stmt = (
                select(Model)
                .filter(Model.model_name == model_name)
                .filter(Model.provider_id == provider.id)
            )
        else:
            stmt = select(Model).filter(Model.model_name == model_name)

        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_provider_by_name(self, provider_name):
        stmt = select(ModelProvider).filter(ModelProvider.name == provider_name)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()