# 工具类简化操作
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user_setting import UserSetting
from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger(__name__)

class SettingsManager:

    def __init__(self, user_id: str, session: AsyncSession):
        self.user_id = user_id
        self.session = session
        # stmt = select(UserSetting).where(UserSetting.user_id == user_id)
        # obj = await self.session.execute(settings)

    async def load(self):
        stmt = select(UserSetting).filter(UserSetting.user_id == self.user_id)
        result = await self.session.execute(stmt)
        self.setting_model = result.scalar_one_or_none()
        if not self.setting_model:
            self.setting_model = UserSetting(user_id=self.user_id)

    def get(self, key, default=None):
        if self.setting_model and self.setting_model.settings:
            if key in self.setting_model.settings:
                return self.setting_model.settings[key]
        return default

    def set(self, key, value):
        # logger.info(f"{self.user_id} {key} {value}")
        if self.setting_model:
            if not self.setting_model.settings:
                self.setting_model.settings = {}
            self.setting_model.settings[key] = value  
            flag_modified(self.setting_model, 'settings')

    def get_all(self):
        return self.setting_model.settings if self.setting_model else {}

    async def save(self):
        if self.setting_model:
            if not self.setting_model.id:
                self.session.add(self.setting_model)
            await self.session.flush()
