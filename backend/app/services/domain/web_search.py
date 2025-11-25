import openai
import requests
import json

# from app.services.llm_service import LLMService

# 配置API密钥
openai.api_key = "your-openai-api-key"
SERPER_API_KEY = "64574816f00e700629e18cea9f479e0556dcfa76"


class WebSearch:
    # lm_service: LLMService = None

    # def __init__(self, lm_service: LLMService):
    #     self.lm_service = lm_service

    def search_with_serper(self, query, num_results=5):
        """使用Serper API进行搜索"""
        url = "https://google.serper.dev/search"
        headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
        payload = {"q": query, "num": num_results, "hl": "zh-cn"}

        response = requests.post(url, headers=headers, data=json.dumps(payload))
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"搜索失败: {response.status_code}")

    def get_search_context(self, search_results):
        """从搜索结果中提取有用的上下文信息"""
        # 提取有机搜索结果
        if "organic" in search_results:
            return [
                {
                    "title": result.get("title"),
                    "link": result.get("link"),
                    "snippet": result.get("snippet"),
                    "position": result.get("position"),
                }
                for result in search_results["organic"][:3]
            ]
        return []

    def generate_search_query(self, user_query):
        """使用LLM优化搜索词"""
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "将用户问题转换为最适合搜索引擎的关键词，保持简洁明了。",
                },
                {"role": "user", "content": user_query},
            ],
            max_tokens=50,
        )

        search_query = response.choices[0].message.content.strip()
        search_query = self.lm_service.completions
        return search_query

    def search(self, user_query):
        """结合搜索功能的聊天函数"""

        # 步骤1: 进行搜索
        search_results = self.search_with_serper(user_query)
        return self.get_search_context(search_results)

    #         # 步骤2: 将搜索结果作为上下文提供给LLM
    #     enhanced_prompt = f"""
    # 基于以下搜索信息来回答问题：

    # 搜索信息：
    # {search_context}

    # 用户问题：{user_query}

    # 请根据以上信息回答用户的问题，如果信息不足请注明。
    # """
    #     else:
    #         enhanced_prompt = user_query

    #     # 步骤3: 调用OpenAI API
    #     response = openai.ChatCompletion.create(
    #         model="gpt-3.5-turbo",
    #         messages=[
    #             {
    #                 "role": "system",
    #                 "content": "你是一个有帮助的助手，能够结合网络搜索信息回答问题。",
    #             },
    #             {"role": "user", "content": enhanced_prompt},
    #         ],
    #         max_tokens=1000,
    #     )

    #     return response.choices[0].message.content


# 使用示例
# web_search = WebSearch()
# result = web_search.search_with_serper("今天北京天气怎么样？")
# print(result)
