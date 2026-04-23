const tiktoken = require('tiktoken');
const path = require('path');
const fs = require('fs');

/**
 * 测试自定义 Tiktoken 模型文件
 */
async function testCustomTiktokenModel() {
  console.log('='.repeat(60));
  console.log('测试 Kimi 自定义 Tiktoken 模型');
  console.log('='.repeat(60));

  const modelPath = path.join(__dirname, '../src/common/utils/tokenizers/moonshotai/Kimi-K2.5/tiktoken.model');

  if (!fs.existsSync(modelPath)) {
    console.error(`❌ 找不到模型文件: ${modelPath}`);
    return;
  }

  try {
    // 1. 尝试加载自定义模型
    console.log('\n1. 正在检查 tiktoken 库支持...');
    console.log('tiktoken 导出:', Object.keys(tiktoken));

    // 注意: Node.js 的 tiktoken 库通常不直接支持 .model 文件加载
    // 我们主要测试它与标准编码的差异

    const enc = tiktoken.get_encoding("cl100k_base");
    const o200kEnc = tiktoken.get_encoding("o200k_base");

    // 2. 准备测试文本
    const testTexts = [
      "Hello, world!",
      "你好，世界！",
      "这是一个中英混合的测试文本：AI Chat System v1.0",
      fs.readFileSync(path.join(__dirname, '../../data/我的室友是幽灵.txt'), 'utf-8').substring(0, 1000) // 取前1000字
    ];

    console.log('\n2. 开始分词对比测试 (cl100k_base vs o200k_base):\n');

    for (let i = 0; i < testTexts.length; i++) {
      const text = testTexts[i];
      const label = i === 3 ? "长文本片段 (1000字)" : `测试文本 ${i + 1}`;

      const start1 = Date.now();
      const tokens1 = enc.encode(text);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      const tokens2 = o200kEnc.encode(text);
      const time2 = Date.now() - start2;

      const diff = tokens2.length - tokens1.length;
      const diffPercent = ((diff / tokens1.length) * 100).toFixed(2);

      console.log(`--- ${label} ---`);
      console.log(`  cl100k_base Tokens: ${tokens1.length} (${time1}ms)`);
      console.log(`  o200k_base Tokens:  ${tokens2.length} (${time2}ms)`);
      console.log(`  差异: ${diff > 0 ? '+' : ''}${diff} (${diffPercent}%)\n`);
    }

    console.log('='.repeat(60));
    console.log('✅ 测试完成');
    console.log('提示: Kimi 可能使用的是 o200k_base 或自定义变体。');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testCustomTiktokenModel();
