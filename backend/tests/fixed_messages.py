import os
import sys
import time


# 获取当前脚本的绝对路径
current_script_path = os.path.abspath(__file__)

# 获取当前脚本所在的目录
current_directory = os.path.dirname(current_script_path)
sys.path.append(os.path.dirname(current_directory))
os.chdir(os.path.dirname(current_directory))

from character_service import get_character_service
from message_service import get_message_service
from session_service import get_session_service

sessions = get_session_service().get_all_sessions()

for session in sessions:
    # messages = get_message_service().get_messages(session["id"])
    # for i, message in enumerate(messages):
    #     print(f"{i + 1}. {message['content']}")
    #     if i > 0:
    #         get_message_service().update_message(
    #             message_id=message["id"], data={"parent_id": messages[i - 1]["id"]}
    #         )
    #     else :
    #         get_message_service().update_message(
    #             message_id=message["id"], data={"parent_id": None}
    #         )
    character = get_character_service().get_character_by_id(session["character_id"])
    get_session_service().update_session(session["id"], {"name": character["title"]})