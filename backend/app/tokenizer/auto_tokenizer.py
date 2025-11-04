# pip3 install transformers
# python3 deepseek_tokenizer.py
from typing import Dict
import tiktoken
from tokenizers import Tokenizer


_tokenizer_mapping = {
    "deepseek": "tokenizer/deepseek.json",
    "qwen3": "tokenizer/qwen3.json",
    "qwen2": "tokenizer/qwen2.json",
    "qwen": "tokenizer/qwen3.json",
    "Ring-1T": "tokenizer/Ring-1T.json",
    "Ling-1T": "tokenizer/Ling-1T.json",
    "GLM": "tokenizer/GLM-4.6.json",
    "MinMax": "tokenizer/MiniMax-M2.json",
    "ERNIE": "tokenizer/ERNIE-4.5-300B-A47B-PT.json",
    "Hunyuan": "tokenizer/Hunyuan-7B-Instruct.json",
    "LongCat": "tokenizer/LongCat-Flash-Thinking.json",
}


# import transformers
class _Tokenizer:
    def __init__(self, model):
        self.model = model

    def count_tokens(self, text) -> int:
        return 0


class _TransformersTokenizer(_Tokenizer):
    def __init__(self, model):
        super().__init__(model)
        self.tokenizer = Tokenizer.from_file(
            "app/tokenizer/" + _tokenizer_mapping[model]
        )

    def count_tokens(self, text):
        return len(self.tokenizer.encode(text))


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


_tokenizer_cache: Dict[str, _Tokenizer] = {}


def get_tokenizer(model: str) -> _Tokenizer:
    model = model.lower()

    for k, v in _tokenizer_mapping.items():
        if model.find(k.lower()) >= 0:
            if k not in _tokenizer_cache:
                _tokenizer_cache[k] = _TransformersTokenizer(k)
            return _tokenizer_cache[k]

    return _OpenAITokenizer(model)
