import logging
import os
from app import create_app

logger = logging.getLogger(__name__)

# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)

os.chdir(current_directory)

logger.debug("当前脚本路径:%s", current_script_path)
logger.debug("当前脚本目录:%s", current_directory)
logger.debug("拼接后的文件路径:%s", os.path.join(current_directory, "static"))


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
