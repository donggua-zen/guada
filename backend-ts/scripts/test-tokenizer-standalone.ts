import { Tokenizer } from "@huggingface/tokenizers";
import * as path from "path";

async function testTokenizer() {
  try {
    console.log("正在加载 Qwen3 Tokenizer...");
    const tokenizerPath = path.join(__dirname, "../src/common/utils/tokenizer/qwen3.json");
    const tokenizer = await Tokenizer.fromFile(tokenizerPath);
    console.log("Tokenizer 加载成功！\n");

    // 测试 1: 简单文本
    const text1 = "你好，世界！Hello, World!";
    const encoded1 = tokenizer.encode(text1);
    console.log(`测试 1 - 简单文本:`);
    console.log(`  文本: "${text1}"`);
    console.log(`  Token 数量: ${encoded1.tokens.length}`);
    console.log(`  Tokens: ${encoded1.tokens.join(", ")}\n`);

    // 测试 2: 中文长文本
    const text2 = "人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。";
    const encoded2 = tokenizer.encode(text2);
    console.log(`测试 2 - 中文长文本:`);
    console.log(`  文本长度: ${text2.length} 字符`);
    console.log(`  Token 数量: ${encoded2.tokens.length}\n`);

    // 测试 3: 混合内容
    const text3 = `System: 你是一个AI助手
User: 请帮我写一段Python代码
Assistant: 好的，这是一个示例：
\`\`\`python
def hello():
    print("Hello, World!")
\`\`\``;
    const encoded3 = tokenizer.encode(text3);
    console.log(`测试 3 - 混合内容（包含代码）:`);
    console.log(`  文本长度: ${text3.length} 字符`);
    console.log(`  Token 数量: ${encoded3.tokens.length}\n`);

    // 测试 4: 消息数组格式
    const messages = [
      { role: "system", content: "你是一个助手" },
      { role: "user", content: "请介绍一下你自己" },
      { role: "assistant", content: "我是一个人工智能助手，可以帮助你解答问题。" },
    ];

    let totalTokens = 0;
    for (const msg of messages) {
      if (msg.content) {
        const encoded = tokenizer.encode(msg.content);
        totalTokens += encoded.tokens.length;
      }
    }
    console.log(`测试 4 - 消息数组:`);
    console.log(`  消息数量: ${messages.length}`);
    console.log(`  总 Token 数量: ${totalTokens}\n`);

    console.log("✅ 所有测试通过！Tokenizer 工作正常。");
  } catch (error) {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  }
}

testTokenizer();
