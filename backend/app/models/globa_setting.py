from .database import ModelBase, db


class GlobalSetting(ModelBase):
    __tablename__ = "global_settings"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text)  # 使用Text类型存储各种值
    value_type = db.Column(
        db.String(20), default="str"
    )  # 值类型：str, int, float, bool, json
    description = db.Column(db.Text)  # 设置项描述
    category = db.Column(db.String(50), default="general")  # 分类：model, ui, system等
    created_at = db.Column(db.DateTime, default=db.func.now())
    updated_at = db.Column(
        db.DateTime,
        default=db.func.now(),
        onupdate=db.func.now(),
    )

    def __repr__(self):
        return f"<GlobalSetting {self.key}>"
