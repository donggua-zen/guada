import datetime
import logging
from app.repositories.model_repository import ModelRepository
from app.services.domain.llm_service import LLMService
from app.services.domain.web_search_engine import WebSearchEngine
from app.services.settings_manager import SettingsManager

logger = logging.getLogger(__name__)


class WebSearch:
    def __init__(
        self,
        api_key=SettingsManager.get("search_api_key", ""),
        context_length=SettingsManager.get("search_prompt_context_length", 10),
        model_id=SettingsManager.get("default_search_model_id", None),
    ):
        self.api_key = api_key
        self.context_length = context_length
        self.model_id = model_id

    def search(self, messages: list[dict]):
        if self.model_id and self.model_id != "current":
            search_model = ModelRepository.get_model(model_id=self.model_id)
            if search_model:  # 搜索功能需要模型
                model = search_model

        if not self.api_key:  # 搜索功能需要API Key
            raise ValueError("api_key is required")

        conversation_messages = [
            f'<role="{msg["role"]}">{msg["content"]}<role="{msg["role"]}">'
            for msg in messages[-self.context_length :]
        ]
        prompt = "请根据聊天记录，为最新的用户提问，生成一个简洁明了的搜索词，用于后续的网页搜索。直接输出，不要进行任何额外描述。\n"
        prompt += "对话记录：\n" + "\n".join(conversation_messages)
        current_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        prompt += f"\n当前日期：{current_date}"

        llm_service = LLMService(model.provider.api_url, model.provider.api_key)
        chunk = llm_service.completions(
            model.model_name,
            [{"role": "user", "content": prompt}],
            temperature=None,
            top_p=None,
            frequency_penalty=None,
            stream=False,
            thinking=False,
            complete_chunk=None,
        )

        logger.debug("搜索词：%s", chunk.content)
        engine = WebSearchEngine(api_key=self.api_key)
        results = engine.search(chunk.content)
        return "\n".join(
            [
                f"position:{result['position']}\nsite:{result['site']}\nname:{result['name']}\nsummary:{result['summary']}\n"
                for result in results
            ]
        )
