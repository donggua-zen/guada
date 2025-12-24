import httpx
import json
import logging

logger = logging.getLogger(__name__)


class WebSearchEngine:

    def __init__(self, api_key: str):
        self.serper_api_key = api_key
        self.client = httpx.AsyncClient(timeout=30.0)  # 创建异步HTTP客户端

    async def search(self, user_query):
        url = "https://api.bocha.cn/v1/web-search"

        payload = json.dumps({"query": user_query, "summary": True, "count": 20})

        headers = {
            "Authorization": "Bearer sk-051263deee2a4a44892e54c37420d6cc",
            "Content-Type": "application/json",
        }

        response = await self.client.post(url, headers=headers, data=payload)
        if response.status_code != 200:
            raise Exception(f"搜索失败: {response.status_code}")
        
        response_data = response.json()
        results = []
        index = 0
        for result in response_data["data"]["webPages"]["value"]:
            results.append(
                {
                    "name": result.get("name"),
                    "url": result.get("url"),
                    "snippet": result.get("snippet"),
                    "summary": result.get("summary"),
                    "position": index,
                    "site": result.get("site"),
                }
            )
            index += 1
        return results

    async def __aenter__(self):
        """异步上下文管理器入口"""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器出口，用于关闭客户端"""
        await self.client.aclose()