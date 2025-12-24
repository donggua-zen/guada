# 工具类简化操作
import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert, update
from app.models.globa_setting import GlobalSetting


class SettingsManager:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, key, default=None):
        stmt = select(GlobalSetting).where(GlobalSetting.key == key)
        result = await self.session.execute(stmt)
        setting = result.scalar_one_or_none()
        if setting:
            # 根据value_type转换值
            if setting.value_type == "int":
                return int(setting.value) if setting.value else default
            elif setting.value_type == "float":
                return float(setting.value) if setting.value else default
            elif setting.value_type == "bool":
                return setting.value.lower() == "true" if setting.value else default
            elif setting.value_type == "json":
                return json.loads(setting.value) if setting.value else default
            else:
                return setting.value or default
        return default

    async def set(self, key, value, value_type="auto", description="", category="general"):
        if value_type == "auto":
            if isinstance(value, bool):
                value_type = "bool"
            elif isinstance(value, int):
                value_type = "int"
            elif isinstance(value, float):
                value_type = "float"
            elif isinstance(value, (dict, list)):
                value_type = "json"
                value = json.dumps(value)
            elif value is None:
                value_type = "str"
                value = ""
            else:
                value_type = "str"

        stmt = select(GlobalSetting).where(GlobalSetting.key == key)
        result = await self.session.execute(stmt)
        setting = result.scalar_one_or_none()
        
        if setting:
            # 更新现有设置
            update_stmt = update(GlobalSetting).where(
                GlobalSetting.key == key
            ).values(
                value=str(value),
                value_type=value_type,
                description=description or setting.description,
                category=category or setting.category
            )
            await self.session.execute(update_stmt)
        else:
            # 创建新设置
            new_setting = GlobalSetting(
                key=key,
                value=str(value),
                value_type=value_type,
                description=description,
                category=category,
            )
            self.session.add(new_setting)

        await self.session.commit()
        return new_setting