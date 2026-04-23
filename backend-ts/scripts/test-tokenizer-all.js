const { Tokenizer } = require('@huggingface/tokenizers');
const path = require('path');
const fs = require('fs');

async function testAllModels() {
  const models = ['qwen3', 'deepseek', 'GLM'];

  for (const model of models) {
    try {
      console.log(`\n========== 测试 ${model} ==========`);
      const tokenizerPath = path.join(__dirname, `../src/common/utils/tokenizer/${model === 'qwen3' ? 'qwen3' : model === 'deepseek' ? 'deepseek' : 'GLM-4.6'}.json`);

      if (!fs.existsSync(tokenizerPath)) {
        console.log(`⚠️  文件不存在: ${tokenizerPath}`);
        continue;
      }

      const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
      const tokenizer = new Tokenizer(tokenizerJson, {});

      // 测试文本
      const tests = [
        { name: '简单中英文', text: '你好，世界！Hello, World!' },
        { name: '中文长文本', text: '人工智能是计算机科学的一个分支，它企图了解智能的实质。' },
        { name: '代码片段', text: '```python\ndef hello():\n    print("Hello")\n```' },
      ];

      for (const test of tests) {
        const encoded = tokenizer.encode(test.text);
        console.log(`  ${test.name}: ${encoded.ids.length} tokens`);
      }

      console.log(`✅ ${model} 测试通过`);
    } catch (error) {
      console.error(`❌ ${model} 测试失败:`, error.message);
    }
  }
}

testAllModels();
