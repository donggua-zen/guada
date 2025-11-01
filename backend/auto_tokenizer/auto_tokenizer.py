# pip3 install transformers
# python3 deepseek_tokenizer.py
from typing import Dict
import tiktoken
from tokenizers import Tokenizer


# import transformers
class _Tokenizer:
    def __init__(self, model):
        self.model = model

    def count_tokens(self, text) -> int:
        return 0


class _DeepSeekTokenizer(_Tokenizer):
    def __init__(self, model):
        super().__init__(model)
        self.tokenizer = Tokenizer.from_file("./auto_tokenizer/tokenizer.json")

    def count_tokens(self, text):
        return len(self.tokenizer.encode(text))


class _QwenTokenizer(_Tokenizer):

    def __init__(self, model):
        super().__init__(model)

    def count_tokens(self, text):
        encoding = tiktoken.get_encoding("o200k_base")
        return len(encoding.encode(text))


class _OpenAITokenizer(_Tokenizer):
    model_encoding_map = {
        # OpenAI Models
        "gpt-4o": "o200k_base",
        "gpt-4-turbo": "o200k_base",
        "gpt-4": "cl100k_base",
        "gpt-3.5-turbo": "cl100k_base",
        # 其他模型近似匹配
        "llama-3-70b-instruct": "cl100k_base",  # 近似匹配
        "claude-3-opus-20240229": "cl100k_base",  # 近似匹配
        "mixtral-8x7b-instruct": "cl100k_base",  # 近似匹配
        # ... 其他模型
    }

    def __init__(self, model):
        super().__init__(model)

    def count_tokens(self, text):
        encoding_name = self.model_encoding_map.get(
            self.model, "cl100k_base"
        )  # 默认回退

        try:
            encoding = tiktoken.get_encoding(encoding_name)
        except KeyError:
            # 如果编码不存在，回退到 cl100k_base
            encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))


class _AutoTokenizer:
    _tokenizer_cache: Dict[str, _Tokenizer] = {}

    def __init__(self):
        pass

    def get_tokenizer(self, model: str):
        model = model.lower()
        if model not in self._tokenizer_cache:
            if model.find("deepseek") >= 0:
                self._tokenizer_cache[model] = _DeepSeekTokenizer(model)
            elif model.find("qwen") >= 0:
                self._tokenizer_cache[model] = _QwenTokenizer(model)
            else:
                self._tokenizer_cache[model] = _OpenAITokenizer(model)

        return self._tokenizer_cache[model]


AutoTokenizer = _AutoTokenizer()
