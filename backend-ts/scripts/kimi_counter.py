import sys, os, json
from types import SimpleNamespace

# 路径处理
utils_dir = sys.argv[1]
sys.path.append(utils_dir)

from kimi import TikTokenTokenizer

model_path = sys.argv[2]
config_path = sys.argv[3]
temp_file = sys.argv[4]

try:
    with open(config_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    decoder_dict = {}
    for k, v in config.get("added_tokens_decoder", {}).items():
        decoder_dict[int(k)] = SimpleNamespace(**v)

    tokenizer = TikTokenTokenizer(
        vocab_file=model_path,
        added_tokens_decoder=decoder_dict,
        bos_token="[BOS]",
        eos_token="[EOS]",
        pad_token="[PAD]",
        unk_token="[UNK]",
    )

    with open(temp_file, "r", encoding="utf-8") as f:
        text = f.read()

    print(len(tokenizer.encode(text)))
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
