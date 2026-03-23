import logging
import os

from dotenv import load_dotenv

load_dotenv()  # 默认会从当前目录加载 .env 文件

# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)

os.chdir(current_directory)



if __name__ == "__main__":
    import uvicorn

    # app = create_app()

    uvicorn.run(
        "app:create_app",
        host="0.0.0.0",
        port=8800,
        reload=True,
        reload_includes=["app"],
    )
