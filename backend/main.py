import os
from flask import Flask
from flask_cors import CORS
from routes.sessions import sessions_bp
from routes.messages import messages_bp
from routes.characters import characters_bp
from routes.models import models_bp
from routes.upload import upload_bp

# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)

os.chdir(current_directory)

print("当前脚本路径:", current_script_path)
print("当前脚本目录:", current_directory)
print("拼接后的文件路径:", os.path.join(current_directory, "static"))


def create_app():
    app = Flask(__name__, static_folder=os.path.join(current_directory, "static"))
    # app.config.from_object(Config)

    # 注册蓝图
    app.register_blueprint(sessions_bp)
    app.register_blueprint(messages_bp)
    app.register_blueprint(characters_bp)
    app.register_blueprint(models_bp)
    app.register_blueprint(upload_bp)

    CORS(app, methods=["GET", "POST", "DELETE", "PUT"])

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
