import { OpenAI } from 'openai';

// 模拟从数据库获取的配置（请根据实际情况修改）
const MODEL_NAME = 'deepseek-ai/DeepSeek-V3'; // 尝试使用标准的模型 ID
const API_KEY = process.env.SILICONFLOW_API_KEY || 'sk-placeholder';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1'; // 假设是硅基流动

async function testNonStreamCompletion() {
    console.log(`Testing non-stream completion with model: ${MODEL_NAME}`);
    console.log(`Base URL: ${BASE_URL}`);

    const client = new OpenAI({
        baseURL: BASE_URL,
        apiKey: API_KEY,
    });

    const prompt = "请根据以下对话内容，生成一个简洁、准确且具有描述性的会话标题（不超过 20 个字）。直接返回标题即可，不需要其他解释。\n\n用户问题：你好\n\n助手回答：你好！很高兴见到你！\n\n生成的标题：";

    try {
        // 尝试非流式调用
        const params: any = {
            model: MODEL_NAME,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            temperature: 0.3,
            max_tokens: 50,
        };
        
        // 模拟 llm.service.ts 中的逻辑：只有 thinking 为 true 时才添加
        // params.enable_thinking = false; 

        const response = await client.chat.completions.create(params);

        console.log('Success! Response:', response.choices[0].message.content);
    } catch (error: any) {
        console.error('Error occurred:');
        console.error('Status:', error.status);
        console.error('Message:', error.message);
        if (error.response) {
            console.error('Response Data:', await error.response.text());
        }
    }
}

testNonStreamCompletion();
