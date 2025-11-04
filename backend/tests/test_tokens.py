import os
import sys
import time


# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from app.auto_tokenizer.auto_tokenizer import AutoTokenizer
from app.utils.chunking import chunking_messages
from app.services import ModelService, LLMService
from app import create_app

app = create_app()
model_service = ModelService()

with app.app_context():

    model = model_service.get_model_by_name(
        "deepseek-ai/DeepSeek-V3.2-Exp", provider_name="硅基流动"
    )

    provider = model_service.get_provider_by_name("硅基流动")

    if provider is None:
        print("未找到模型")
        exit(1)

    import re

    def parse_chat_log(filename):
        """
        从本地文件导入聊天记录并解析为对话数组

        Args:
            filename (str): 聊天记录文件名

        Returns:
            list: 包含对话字典的列表，格式为 [{"role": "xxx", "content": "xxx"}, ...]
        """
        try:
            with open(filename, "r", encoding="utf-8") as file:
                content = file.read()
        except FileNotFoundError:
            print(f"错误：文件 '{filename}' 未找到")
            return []
        except Exception as e:
            print(f"读取文件时出错：{e}")
            return []

        # 使用正则表达式匹配对话块
        # 匹配模式：▶ ROLE: 后跟内容（可能跨多行），直到下一个▶或文件结束
        pattern = r"▶\s*(\w+)\s*:\s*(.*?)(?=\s*▶\s*\w+\s*:|$)"
        matches = re.findall(pattern, content, re.DOTALL)

        dialogues = []
        valid_roles = {"SYSTEM", "USER", "ASSISTANT"}

        for role, content in matches:
            # 将角色转换为小写（符合常见API格式）
            role_lower = role.strip().upper()

            # 只处理有效的角色
            if role_lower in valid_roles:
                # 过滤内容的前后空白
                cleaned_content = content.strip()

                # 如果内容不为空，则添加到对话列表
                if cleaned_content:
                    dialogues.append(
                        {
                            "role": role_lower.lower(),  # 转换为小写：system, user, assistant
                            "content": cleaned_content,
                        }
                    )

        return dialogues

    # messages = get_message_service().get_messages(chat_session_id)
    messages = parse_chat_log("../data/我的室友是幽灵.txt")

    print(f"总消息数: {len(messages)}")
    test_models = [
        "deepseek",
        "qwen3",
        "qwen2",
        "qwen",
        "Ring-1T",
        "Ling-1T",
        "GLM",
        "MinMax",
        "ERNIE",
        "openai",
    ]

    def count_tokens(model, text):
        tokenizer = AutoTokenizer.get_tokenizer(model)
        return tokenizer.count_tokens(text)

    MAX_TOKENS = 8192

    lager_content = ""
    for i, message in enumerate(messages):
        lager_content += message["content"]

    print(f"消息 {len(messages)}: chars:{len(lager_content)}")
    for model_name in test_models:
        tokens = count_tokens(model_name, lager_content)
        print(f"{model_name} tokens:{tokens}")
    print("-" * 20)
