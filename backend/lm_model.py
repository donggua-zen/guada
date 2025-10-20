from llama_cpp import Llama
class LocalModel:
    def __init__(self):
        pass

    def load_model(self):
        # 指定本地模型路径
        model_path = "D:\lm_studio_modes\ystemsrx\Qwen2.5_Sex\ggml-model-f16.gguf"  # 替换为您的实际路径

        # 初始化模型
        llm = Llama(
            model_path=model_path,  # 本地模型文件路径
            n_ctx=2048,            # 上下文长度
            n_threads=3,           # CPU 线程数（根据您的CPU核心数调整）
            n_gpu_layers=0,       # 使用GPU加速的层数（如不使用GPU设为0）
            verbose=True ,         # 是否显示详细日志
            rope_scaling_type=0,
            rope_freq_base=10000.0,
            rope_freq_scale=1.0
        )

        # 使用模型
        response = llm("你好，请介绍一下你自己", max_tokens=256)
        print(response['choices'][0]['text'])

def main():
    local_model = LocalModel()
    local_model.load_model()

if __name__ == "__main__":
    main()