import os
from app import create_app

# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)

os.chdir(current_directory)

print("当前脚本路径:", current_script_path)
print("当前脚本目录:", current_directory)
print("拼接后的文件路径:", os.path.join(current_directory, "static"))


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
