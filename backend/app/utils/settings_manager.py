# 工具类简化操作
import json
from app.models.globa_setting import GlobalSetting, db


class SettingsManager:
    @staticmethod
    def get(key, default=None):
        setting = GlobalSetting.query.filter_by(key=key).first()
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

    @staticmethod
    def set(key, value, value_type="auto", description="", category="general"):
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

        setting = GlobalSetting.query.filter_by(key=key).first()
        if setting:
            setting.value = str(value)
            setting.value_type = value_type
            setting.description = description or setting.description
            setting.category = category or setting.category
        else:
            setting = GlobalSetting(
                key=key,
                value=str(value),
                value_type=value_type,
                description=description,
                category=category,
            )
            db.session.add(setting)

        db.session.commit()
        return setting


# 使用示例
# settings_manager = SettingsManager()

# # 设置值
# settings_manager.set(
#     "default_model", "gpt-4", description="默认AI模型", category="model"
# )
# settings_manager.set("max_tokens", 1000, value_type="int", category="model")
# settings_manager.set("temperature", 0.7, value_type="float", category="model")
# settings_manager.set("enable_history", True, category="system")

# # 获取值
# default_model = settings_manager.get("default_model", "gpt-3.5-turbo")
# max_tokens = settings_manager.get("max_tokens", 500)
