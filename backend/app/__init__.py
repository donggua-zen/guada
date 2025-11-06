# app/__init__.py
from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from config import app_config
import logging
from logging.handlers import RotatingFileHandler
import os
from .models.database import init_db, db


def create_app(config_name=None):
    """创建Flask应用的工厂函数"""

    if config_name is None:
        config_name = os.environ.get("FLASK_CONFIG", "development")

    app = Flask(__name__, static_folder="static")

    # 加载配置
    app.config.from_object(app_config[config_name])

    # 初始化应用
    AppInitializer(app).initialize()

    return app


class AppInitializer:
    """应用初始化器"""

    def __init__(self, app):
        self.app = app

    def initialize(self):
        """执行所有初始化操作"""
        self.initialize_extensions()
        self.initialize_blueprints()
        self.initialize_error_handlers()
        self.initialize_shell_context()
        self.initialize_logging()
        CORS(self.app, methods=["GET", "POST", "DELETE", "PUT"])

    def initialize_extensions(self):
        """初始化扩展"""
        init_db(self.app)

        # 其他扩展初始化
        from flask_migrate import Migrate

        self.migrate = Migrate(self.app, db)

        # from flask_login import LoginManager
        # self.login_manager = LoginManager(self.app)

    def initialize_blueprints(self):
        """注册蓝图"""
        # 动态导入避免循环导入
        from app.routes.sessions import sessions_bp
        from app.routes.messages import messages_bp
        from app.routes.characters import characters_bp
        from app.routes.models import models_bp
        from app.routes.upload import upload_bp
        from app.routes.chat import chat_bp

        self.app.register_blueprint(sessions_bp)
        self.app.register_blueprint(messages_bp)
        self.app.register_blueprint(characters_bp)
        self.app.register_blueprint(models_bp)
        self.app.register_blueprint(upload_bp)
        self.app.register_blueprint(chat_bp)

    def initialize_error_handlers(self):
        """注册错误处理器"""
        # from app.errors import not_found_error, internal_error

        # self.app.register_error_handler(404, not_found_error)
        # self.app.register_error_handler(500, internal_error)
        pass

    def initialize_shell_context(self):
        """注册shell上下文"""

        # @self.app.shell_context_processor
        # def make_shell_context():
        #     from app.models import User, Post, Comment

        #     return {"db": db, "User": User, "Post": Post, "Comment": Comment}
        pass

    def initialize_logging(self):
        """配置日志"""
        if not self.app.debug and not self.app.testing:
            if not os.path.exists("logs"):
                os.mkdir("logs")

            file_handler = RotatingFileHandler(
                "logs/app.log", maxBytes=10240, backupCount=10
            )
            file_handler.setFormatter(
                logging.Formatter(
                    "%(asctime)s %(levelname)s: %(message)s "
                    "[in %(pathname)s:%(lineno)d]"
                )
            )
            file_handler.setLevel(logging.INFO)
            self.app.logger.addHandler(file_handler)
            self.app.logger.setLevel(logging.INFO)
            self.app.logger.info("应用启动")
