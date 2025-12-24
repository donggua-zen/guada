import logging
import os

from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles

load_dotenv()  # 默认会从当前目录加载 .env 文件

from app import create_app
from app.config import settings

logger = logging.getLogger(__name__)

# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)

os.chdir(current_directory)

logger.debug("当前脚本路径:%s", current_script_path)
logger.debug("当前脚本目录:%s", current_directory)


if __name__ == "__main__":
    import uvicorn

    # app = create_app()

    uvicorn.run(
        "app:create_app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_includes=["app"],
    )
