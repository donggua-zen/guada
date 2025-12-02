import openai
import requests
import json
import logging

logger = logging.getLogger(__name__)
# from app.services.llm_service import LLMService

# 配置API密钥
# openai.api_key = "your-openai-api-key"
# SERPER_API_KEY = "64574816f00e700629e18cea9f479e0556dcfa76"


# class WebSearch:
#     # lm_service: LLMService = None
#     serper_api_key: str = ""

#     def __init__(self, serper_api_key: str):
#         self.serper_api_key = serper_api_key

#     def search_with_serper(self, query, num_results=5):
#         """使用Serper API进行搜索"""
#         url = "https://google.serper.dev/search"
#         headers = {"X-API-KEY": self.serper_api_key, "Content-Type": "application/json"}
#         payload = {"q": query, "num": num_results, "hl": "zh-cn"}

#         response = requests.post(url, headers=headers, data=json.dumps(payload))
#         if response.status_code == 200:
#             return response.json()
#         else:
#             raise Exception(f"搜索失败: {response.status_code}")

#     def get_search_context(self, search_results):
#         """从搜索结果中提取有用的上下文信息"""
#         # 提取有机搜索结果
#         if "organic" in search_results:
#             return [
#                 {
#                     "title": result.get("title"),
#                     "link": result.get("link"),
#                     "snippet": result.get("snippet"),
#                     "position": result.get("position"),
#                 }
#                 for result in search_results["organic"]
#             ]
#         return []

#     def search(self, user_query):
#         """结合搜索功能的聊天函数"""
#         # 步骤1: 进行搜索
#         search_results = self.search_with_serper(user_query)
#         logger.debug(f"搜索结果:")
#         for result in search_results["organic"]:
#             logger.debug(f"{result.get('title')}: {result.get('link')}")
#         return self.get_search_context(search_results)


class WebSearch:

    def __init__(self, api_key: str):
        self.serper_api_key = api_key

    def search(self, user_query):

        url = "https://api.bocha.cn/v1/web-search"

        payload = json.dumps({"query": user_query, "summary": True, "count": 20})

        headers = {
            "Authorization": "Bearer sk-051263deee2a4a44892e54c37420d6cc",
            "Content-Type": "application/json",
        }

        response = requests.request("POST", url, headers=headers, data=payload)
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


# if __name__ == "__main__":
#     web_search = BoChaWebSearch(SERPER_API_KEY)
#     web_search.search("天空为什么是蓝色的？")
