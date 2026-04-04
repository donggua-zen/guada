models_info = [
    {
        "model_name": "Qwen3-Embedding-8B",
        "model_type": "embedding",  # embedding text image video reranker
        "max_context_tokens": 32768,  # 最大上下文
        "max_output_tokens": 8192,
        "features": [],  # tools 工具调用，vision 视觉 thinking 混合思考
    },
    {
        "model_name": "DeepSeek-V3.2",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 65536,
        "features": ["tools", "thinking"],  # 混合思考模型
    },
    {
        "model_name": "MiniMax-M2.5",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["tools", "thinking"],  # 支持思考模式
    },
    {
        "model_name": "GLM-5",
        "model_type": "text",
        "max_context_tokens": 204800,  # 200K
        "max_output_tokens": 32768,
        "features": ["tools", "thinking"],  # 深度推理
    },
    {
        "model_name": "Kimi-K2.5",
        "model_type": "text",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["tools", "thinking", "vision"],  # 原生多模态
    },
    {
        "model_name": "GLM-4.7",
        "model_type": "text",
        "max_context_tokens": 204800,  # 200K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "DeepSeek-V3.1-Terminus",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Qwen3.5-397B-A17B",
        "model_type": "text",
        "max_context_tokens": 262144,  # 256K,可扩展至 1M
        "max_output_tokens": 32768,
        "features": ["tools", "thinking", "vision"],  # 原生多模态
    },
    {
        "model_name": "Qwen3.5-122B-A10B",
        "model_type": "text",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["tools", "thinking", "vision"],
    },
    {
        "model_name": "Qwen3.5-35B-A3B",
        "model_type": "text",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["tools", "thinking"],
    },
    {
        "model_name": "Qwen3.5-27B",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Qwen3.5-9B",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Qwen3.5-4B",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "PaddleOCR-VL-1.5",
        "model_type": "image",
        "max_context_tokens": 8192,
        "max_output_tokens": 4096,
        "features": [],  # OCR 文档解析专用
    },
    {
        "model_name": "DeepSeek-R1",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 16384,
        "features": [],  # 仅思考模型，用户无法控制
    },
    {
        "model_name": "Step-3.5-Flash",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "GLM-4.6V",
        "model_type": "image",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["vision", "tools"],  # 原生多模态
    },
    {
        "model_name": "Kimi-K2-Thinking",
        "model_type": "text",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["tools", "thinking"],  # 深度推理
    },
    {
        "model_name": "GLM-4.6",
        "model_type": "text",
        "max_context_tokens": 204800,  # 200K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Qwen3-VL-32B-Instruct",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "Qwen3-VL-32B-Thinking",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],  # Thinking 版本，固定开启思考
    },
    {
        "model_name": "Qwen3-VL-8B-Instruct",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "Qwen3-VL-8B-Thinking",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],  # Thinking 版本，固定开启思考
    },
    {
        "model_name": "Qwen3-VL-30B-A3B-Instruct",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "Qwen3-VL-30B-A3B-Thinking",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],  # Thinking 版本，固定开启思考
    },
    {
        "model_name": "Qwen3-VL-235B-A22B-Instruct",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "Qwen3-VL-235B-A22B-Thinking",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],  # Thinking 版本，固定开启思考
    },
    {
        "model_name": "Seed-OSS-36B-Instruct",
        "model_type": "text",
        "max_context_tokens": 524288,  # 512K
        "max_output_tokens": 32768,
        "features": ["tools", "thinking"],  # 灵活推理预算
    },
    {
        "model_name": "Wan2.2-I2V-A14B",
        "model_type": "video",
        "max_context_tokens": 4096,
        "max_output_tokens": 2048,
        "features": [],  # 图像转视频生成
    },
    {
        "model_name": "Wan2.2-T2V-A14B",
        "model_type": "video",
        "max_context_tokens": 4096,
        "max_output_tokens": 2048,
        "features": [],  # 文本转视频生成
    },
    {
        "model_name": "TeleSpeechASR",
        "model_type": "text",
        "max_context_tokens": 8192,
        "max_output_tokens": 4096,
        "features": [],  # 语音识别
    },
    {
        "model_name": "Qwen3-Coder-30B-A3B-Instruct",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Qwen3-Coder-480B-A35B-Instruct",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Qwen3-30B-A3B-Thinking-2507",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],  # Thinking 版本，固定开启思考
    },
    {
        "model_name": "Qwen3-30B-A3B-Instruct-2507",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "Qwen3-235B-A22B-Thinking-2507",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],  # Thinking 版本，固定开启思考
    },
    {
        "model_name": "Qwen3-235B-A22B-Instruct-2507",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "GLM-4-32B-0414",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "GLM-Z1-32B-0414",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],  # Z1 为推理版本，固定开启思考
    },
    {
        "model_name": "GLM-4-9B-0414",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "GLM-Z1-9B-0414",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],  # Z1 为推理版本，固定开启思考
    },
    {
        "model_name": "Qwen2.5-VL-32B-Instruct",
        "model_type": "image",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "QwQ-32B",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],  # QwQ 为推理版本，固定开启思考
    },
    {
        "model_name": "Qwen2.5-VL-72B-Instruct",
        "model_type": "image",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "Qwen2.5-72B-Instruct-128K",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "Qwen2.5-72B-Instruct",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Qwen2.5-32B-Instruct",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Qwen2.5-14B-Instruct",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Qwen2.5-7B-Instruct",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "BAAI-bge-m3",
        "model_type": "embedding",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "BAAI-bge-reranker-v2-m3",
        "model_type": "reranker",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "DeepSeek-V3",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Kimi-K2-Instruct-0905",
        "model_type": "text",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Qwen3-Omni-30B-A3B-Instruct",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],  # 多模态
    },
    {
        "model_name": "Qwen3-Omni-30B-A3B-Thinking",
        "model_type": "image",
        "max_context_tokens": 262144,  # 256K
        "max_output_tokens": 32768,
        "features": ["vision"],  # Thinking 版本
    },
    {
        "model_name": "Qwen3-Omni-30B-A3B-Captioner",
        "model_type": "image",
        "max_context_tokens": 8192,
        "max_output_tokens": 4096,
        "features": [],  # 图像描述生成
    },
    {
        "model_name": "DeepSeek-OCR",
        "model_type": "image",
        "max_context_tokens": 8192,
        "max_output_tokens": 4096,
        "features": [],  # OCR 专用
    },
    {
        "model_name": "Ring-flash-2.0",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Ling-flash-2.0",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Ling-mini-2.0",
        "model_type": "text",
        "max_context_tokens": 32768,  # 32K
        "max_output_tokens": 8192,
        "features": [],
    },
    {
        "model_name": "Qwen-Image-Edit-2509",
        "model_type": "image",
        "max_context_tokens": 4096,
        "max_output_tokens": 4096,
        "features": [],  # 图像编辑
    },
    {
        "model_name": "Qwen-Image-Edit",
        "model_type": "image",
        "max_context_tokens": 4096,
        "max_output_tokens": 4096,
        "features": [],  # 图像编辑
    },
    {
        "model_name": "Qwen-Image",
        "model_type": "image",
        "max_context_tokens": 4096,
        "max_output_tokens": 4096,
        "features": [],  # 图像生成
    },
    {
        "model_name": "Hunyuan-MT-7B",
        "model_type": "text",
        "max_context_tokens": 32768,  # 32K
        "max_output_tokens": 8192,
        "features": [],  # 翻译模型
    },
    {
        "model_name": "GLM-4.5V",
        "model_type": "image",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "GLM-4.5-Air",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "ERNIE-4.5-300B-A47B",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["tools"],
    },
    {
        "model_name": "Hunyuan-A13B-Instruct",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "DeepSeek-R1-0528-Qwen3-8B",
        "model_type": "text",
        "max_context_tokens": 32768,  # 32K
        "max_output_tokens": 8192,
        "features": [],  # 蒸馏推理模型
    },
    {
        "model_name": "Qwen3-32B",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "Qwen3-14B",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Qwen3-8B",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],
    },
    {
        "model_name": "Qwen3-Reranker-8B",
        "model_type": "reranker",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "Qwen3-Reranker-4B",
        "model_type": "reranker",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "Qwen3-Embedding-4B",
        "model_type": "embedding",
        "max_context_tokens": 32768,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "Qwen3-Reranker-0.6B",
        "model_type": "reranker",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "Qwen3-Embedding-0.6B",
        "model_type": "embedding",
        "max_context_tokens": 32768,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "pangu-pro-moe",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
    {
        "model_name": "GLM-4.1V-9B-Thinking",
        "model_type": "image",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["vision"],  # Thinking 版本
    },
    {
        "model_name": "internlm2_5-7b-chat",
        "model_type": "text",
        "max_context_tokens": 32768,  # 32K
        "max_output_tokens": 8192,
        "features": [],
    },
    {
        "model_name": "BAAI-bge-large-en-v1.5",
        "model_type": "embedding",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "BAAI-bge-large-zh-v1.5",
        "model_type": "embedding",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "MOSS-TTSD-v0.5",
        "model_type": "text",  # TTS
        "max_context_tokens": 4096,
        "max_output_tokens": 2048,
        "features": [],  # 语音合成
    },
    {
        "model_name": "CosyVoice2-0.5B",
        "model_type": "text",  # TTS
        "max_context_tokens": 4096,
        "max_output_tokens": 2048,
        "features": [],  # 语音合成
    },
    {
        "model_name": "SenseVoiceSmall",
        "model_type": "text",  # ASR
        "max_context_tokens": 8192,
        "max_output_tokens": 4096,
        "features": [],  # 语音识别
    },
    {
        "model_name": "IndexTTS-2",
        "model_type": "text",  # TTS
        "max_context_tokens": 4096,
        "max_output_tokens": 2048,
        "features": [],  # 语音合成
    },
    {
        "model_name": "bce-embedding-base_v1",
        "model_type": "embedding",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "bce-reranker-base_v1",
        "model_type": "reranker",
        "max_context_tokens": 8192,
        "max_output_tokens": 1024,
        "features": [],
    },
    {
        "model_name": "Qwen2.5-Coder-32B-Instruct",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": ["tools"],  # 编程专用
    },
    {
        "model_name": "Kolors",
        "model_type": "image",
        "max_context_tokens": 4096,
        "max_output_tokens": 4096,
        "features": [],  # 图像生成
    },
    {
        "model_name": "Qwen2-VL-72B-Instruct",
        "model_type": "image",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": ["vision"],
    },
    {
        "model_name": "DeepSeek-R1-Distill-Qwen-32B",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],  # 蒸馏推理模型
    },
    {
        "model_name": "DeepSeek-R1-Distill-Qwen-14B",
        "model_type": "text",
        "max_context_tokens": 65536,  # 64K
        "max_output_tokens": 16384,
        "features": [],  # 蒸馏推理模型
    },
    {
        "model_name": "DeepSeek-R1-Distill-Qwen-7B",
        "model_type": "text",
        "max_context_tokens": 32768,  # 32K
        "max_output_tokens": 8192,
        "features": [],  # 蒸馏推理模型
    },
    {
        "model_name": "DeepSeek-V2.5",
        "model_type": "text",
        "max_context_tokens": 131072,  # 128K
        "max_output_tokens": 32768,
        "features": [],
    },
]
