from flask_sqlalchemy import SQLAlchemy

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

    def to_dict(self, exclude=None):
        """将模型转换为字典"""
        if exclude is None:
            exclude = []

        result = {}
        for column in self.__table__.columns:
            if column.name not in exclude:
                if column.name == "created_at" or column.name == "updated_at":
                    result[column.name] = getattr(self, column.name).isoformat()
                else:
                    result[column.name] = getattr(self, column.name)
        return result
