const { Tokenizer } = require('@huggingface/tokenizers');
const path = require('path');
const fs = require('fs');

async function test() {
  try {
    console.log("正在加载 Qwen3 Tokenizer...");
    const tokenizerPath = path.join(__dirname, "../src/common/utils/tokenizer/qwen3.json");

    // 读取 JSON 文件
    const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
    console.log("JSON 文件大小:", tokenizerPath, "keys:", Object.keys(tokenizerJson).slice(0, 5));

    // 尝试创建 Tokenizer（需要两个参数）
    const tokenizer = new Tokenizer(tokenizerJson, {});
    console.log("Tokenizer 创建成功！");

    // 测试编码
    const text = "你好，世界！Hello, World!";
    const encoded = tokenizer.encode(text);
    console.log(`文本: "${text}"`);
    console.log(`Token 数量: ${encoded.ids.length}`);
    console.log("✅ 测试通过！");
  } catch (error) {
    console.error("❌ 错误:", error.message);
    console.error(error.stack);
  }
}

test();
