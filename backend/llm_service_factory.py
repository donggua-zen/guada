# llm_service_factory.py
import threading
from typing import Dict, Optional
from llm_service import LLMService
from ai_models import ai_providers


class LLMServiceFactory:
    _instance = None
    _lock = threading.Lock()
    _service_cache: Dict[str, LLMService] = {}

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(LLMServiceFactory, cls).__new__(cls)
            return cls._instance

    def get_service(self, provider_id: str) -> Optional[LLMService]:
        """
        获取指定供应商的LLMService实例（使用缓存)
        """
        # 检查供应商是否存在
        if provider_id not in ai_providers:
            raise ValueError(
                f"Provider {provider_id} not found in configured providers"
            )

        # 检查是否已启用
        if not ai_providers[provider_id].get("enabled", False):
            raise ValueError(f"Provider {provider_id} is not enabled")

        # 使用缓存中的实例或创建新实例
        if provider_id not in self._service_cache:
            provider_config = ai_providers[provider_id]
            self._service_cache[provider_id] = LLMService(
                base_url=provider_config["base_url"], api_key=provider_config["api_key"]
            )

        return self._service_cache[provider_id]

    def clear_cache(self, provider_id: str = None):
        """
        清理缓存，可选指定特定供应商
        """
        with self._lock:
            if provider_id:
                if provider_id in self._service_cache:
                    del self._service_cache[provider_id]
            else:
                self._service_cache.clear()


# 全局工厂单例
llm_service_factory = LLMServiceFactory()
