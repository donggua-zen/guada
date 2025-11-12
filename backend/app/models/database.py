from flask_sqlalchemy import SQLAlchemy

from app.utils import to_utc8_isoformat

db = SQLAlchemy()


def init_db(app):
    db.init_app(app)
    with app.app_context():
        try:
            print("开始创建数据库表...")
            db.create_all()
            print("数据库表创建成功")
        except Exception as e:
            print(f"数据库创建失败: {e}")
            import traceback

            traceback.print_exc()
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
            db.session.flush()
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
            if hasattr(self, rel_name) and rel_name not in exclude:
                rel_value = getattr(self, rel_name)

                # 处理关系字段的序列化
                if rel_value is None:
                    result[rel_name] = None
                elif isinstance(rel_value, list):
                    # 处理一对多或多对多关系（列表类型）
                    result[rel_name] = []
                    for item in rel_value:
                        if hasattr(item, "to_dict"):
                            result[rel_name].append(item.to_dict())
                        else:
                            result[rel_name].append(str(item))
                elif hasattr(rel_value, "to_dict"):
                    # 处理多对一关系（单个对象）
                    result[rel_name] = rel_value.to_dict()
                else:
                    # 其他处理方式
                    result[rel_name] = str(rel_value)
        return result
