import sys
import os
import time

# 添加 kimi.py 所在目录到路径，以便导入
sys.path.append(os.path.join(os.path.dirname(__file__), "../src/common/utils"))

# 模拟相对导入，避免 ImportError
import tool_declaration_ts

sys.modules["tool_declaration_ts"] = tool_declaration_ts

from kimi import TikTokenTokenizer


def test_kimi_tokenizer():
    print("=" * 60)
    print("Kimi Tokenizer Python 验证测试")
    print("=" * 60)

    # Kimi 模型文件的路径
    model_path = os.path.join(
        os.path.dirname(__file__),
        "../src/common/utils/tokenizers/moonshotai/Kimi-K2.5/tiktoken.model",
    )

    if not os.path.exists(model_path):
        print(f"❌ 找不到模型文件: {model_path}")
        return

    try:
        # 1. 初始化分词器
        print("\n1. 正在加载 Kimi 分词器...")
        start_load = time.time()

        # 读取配置以获取 added_tokens_decoder
        import json
        from types import SimpleNamespace

        config_path = os.path.join(os.path.dirname(model_path), "tokenizer_config.json")
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)

        # 将字典转换为对象，以匹配 kimi.py 中的 .content 访问方式
        decoder_dict = {}
        for k, v in config.get("added_tokens_decoder", {}).items():
            decoder_dict[int(k)] = SimpleNamespace(**v)  # 确保 key 是整数

        tokenizer = TikTokenTokenizer(
            vocab_file=model_path,
            added_tokens_decoder=decoder_dict,
            bos_token="[BOS]",
            eos_token="[EOS]",
            pad_token="[PAD]",
            unk_token="[UNK]",
        )
        load_time = (time.time() - start_load) * 1000
        print(f"✅ 分词器加载成功 (耗时: {load_time:.2f}ms)")

        # 2. 准备测试文本
        test_texts = [
            "Hello, world!",
            "你好，世界！",
            "这是一个中英混合的测试文本：AI Chat System v1.0",
        ]

        # 读取长文本片段
        data_path = os.path.join(
            os.path.dirname(__file__), "../../data/我的室友是幽灵.txt"
        )
        if os.path.exists(data_path):
            with open(data_path, "r", encoding="utf-8") as f:
                test_texts.append(f.read(1000))

        print("\n2. 开始分词测试:\n")

        for i, text in enumerate(test_texts):
            label = f"测试文本 {i + 1}" if i < 3 else "长文本片段 (1000字)"

            start_encode = time.time()
            # 使用 kimi.py 提供的 encode 方法
            token_ids = tokenizer.encode(text)
            encode_time = (time.time() - start_encode) * 1000

            print(f"--- {label} ---")
            print(f"  文本长度: {len(text)} 字符")
            print(f"  Kimi Tokens: {len(token_ids)} (耗时: {encode_time:.2f}ms)")
            # print(f"  Token IDs 前10个: {token_ids[:10]}")
            print()

        print("=" * 60)
        print("✅ Python 验证完成")

    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    test_kimi_tokenizer()
