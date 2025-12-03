import logging
from flask_sqlalchemy import SQLAlchemy

from app.utils import to_utc8_isoformat

db = SQLAlchemy()

logger = logging.getLogger(__name__)


def init_db(app):
    db.init_app(app)
    with app.app_context():
        try:
            logger.debug("开始创建数据库表...")
            db.create_all()
            # 可选：创建默认管理员用户
            from app.models.user import User

            try:
                if not User.query.filter_by(email="admin@dingd.cn").first():
                    admin = User(nickname="admin", email="admin@dingd.cn")
                    admin.set_password("123456")
                    db.session.add(admin)
                    db.session.commit()
            except Exception as e:
                logger.exception(e)
            logger.debug("数据库表创建成功")
        except Exception as e:
            logger.exception(e)
            # 可以选择重新抛出异常或处理
            raise


class ModelBase(db.Model):
    __abstract__ = True

    def to_dict(self, exclude=None, include=None, flush=False):
        """将模型转换为字典"""
        if exclude is None:
            exclude = []
        if include is None:
            include = []
        if flush:
            db.session.flush([self])
        result = {}
        for column in self.__table__.columns:
            if column.name not in exclude:
                if column.name == "created_at" or column.name == "updated_at":
                    value = getattr(self, column.name)
                    if value is None:
                        continue
                    result[column.name] = to_utc8_isoformat(value)
                else:
                    result[column.name] = getattr(self, column.name)
        # 处理包含的关系字段
        for rel_name in include:
            with_field: str = None
            child_include = []
            if isinstance(rel_name, str):
                with_field = rel_name
            elif isinstance(rel_name, dict):
                with_field = rel_name.get("field", "")
                child_include = rel_name.get("include", [])

            if hasattr(self, with_field) and with_field not in exclude:
                rel_value = getattr(self, with_field)

                # 处理关系字段的序列化
                if rel_value is None:
                    result[with_field] = None
                elif isinstance(rel_value, list):
                    # 处理一对多或多对多关系（列表类型）
                    result[with_field] = []
                    for item in rel_value:
                        if hasattr(item, "to_dict"):
                            result[with_field].append(
                                item.to_dict(include=child_include)
                            )
                        else:
                            result[with_field].append(str(item))
                elif hasattr(rel_value, "to_dict"):
                    # 处理多对一关系（单个对象）
                    result[with_field] = rel_value.to_dict(include=child_include)
                else:
                    # 其他处理方式
                    result[with_field] = str(rel_value)
        return result
