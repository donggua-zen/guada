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
        """
        异步加载用户的设置数据
        从数据库中查询当前用户的设置，如果不存在则创建一个新的设置对象
        """
        # 查询当前用户的设置记录
        stmt = select(UserSetting).filter(UserSetting.user_id == self.user_id)
        result = await self.session.execute(stmt)
        self.setting_model = result.scalar_one_or_none()
        # 如果没有找到用户的设置记录，则创建一个新的设置对象
        if not self.setting_model:
            self.setting_model = UserSetting(user_id=self.user_id)

    def get(self, key, default=None):
        """
        从用户设置中获取指定键的值
        
        该方法首先检查setting_model是否存在以及其settings属性是否有效，
        然后判断指定的key是否存在于settings中，如果存在则返回对应的值，
        否则返回默认值
        
        Args:
            key: 要获取的设置项的键名
            default: 当键不存在时返回的默认值，默认为None
        
        Returns:
            如果键存在于用户设置中，则返回对应的值；否则返回默认值
        """
        if self.setting_model and self.setting_model.settings:
            if key in self.setting_model.settings:
                return self.setting_model.settings[key]
        return default

    def set(self, key, value):
        """
        设置指定键的值到用户设置中
        该方法将给定的键值对存储到用户的设置模型中，如果设置模型不存在则不执行任何操作
        
        Args:
            key: 要设置的键名
            value: 要设置的值
        """
        # logger.info(f"{self.user_id} {key} {value}")
        if self.setting_model:
            # 如果settings属性为空，则初始化为空字典
            if not self.setting_model.settings:
                self.setting_model.settings = {}
            # 设置指定键的值
            self.setting_model.settings[key] = value  
            # 标记settings字段已修改，以便ORM能够正确跟踪变更
            flag_modified(self.setting_model, 'settings')

    def get_all(self):
        """
        获取当前用户的所有设置
        如果setting_model存在则返回其settings属性，否则返回空字典
        
        Returns:
            dict: 包含用户所有设置的字典，如果未找到设置模型则返回空字典
        """
        return self.setting_model.settings if self.setting_model else {}

    async def save(self):
        """
        异步保存用户设置到数据库
        如果设置模型对象不存在id，则将其添加到会话中，然后刷新会话
        """
        if self.setting_model:
            # 检查设置模型是否已有ID，如果没有则添加到会话中
            if not self.setting_model.id:
                self.session.add(self.setting_model)
            await self.session.flush()
