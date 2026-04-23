const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Tokenizer } = require('@huggingface/tokenizers');

/**
 * 调用 Python 脚本获取 Kimi 官方 Token 数
 */
function getKimiTokensPython(text, index) {
  return new Promise((resolve, reject) => {
    const tempFile = path.join(__dirname, `temp_kimi_input_${index}.txt`);
    fs.writeFileSync(tempFile, text, 'utf-8');

    const scriptPath = path.join(__dirname, 'kimi_counter.py');
    const pythonPath = 'C:\\Users\\22071\\AppData\\Local\\Programs\\Python\\Python313\\python.exe';

    const utilsDir = path.join(__dirname, '../src/common/utils');
    const modelPath = path.join(__dirname, '../src/common/utils/tokenizers/moonshotai/Kimi-K2.5/tiktoken.model');
    const configPath = path.join(__dirname, '../src/common/utils/tokenizers/moonshotai/Kimi-K2.5/tokenizer_config.json');

    const cmd = `${pythonPath} "${scriptPath}" "${utilsDir}" "${modelPath}" "${configPath}" "${tempFile}"`;

    exec(cmd, { encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

      const realError = stderr && !stderr.includes('None of PyTorch');
      if (error || realError) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(parseInt(stdout.trim()));
      }
    });
  });
}

/**
 * 模拟算法：英文单词数 * 权重 + 中文字符数 * 权重
 */
function simulateTokens(text, enWeight = 1.0, cnWeight = 0.65) {
  const enWords = text.match(/[a-zA-Z0-9]+/g) || [];
  const enCount = enWords.length;
  const cnChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const cnCount = cnChars.length;
  const otherCount = text.length - enWords.join('').length - cnCount;

  return Math.ceil(enCount * enWeight + cnCount * cnWeight + otherCount * 0.3);
}

/**
 * 使用 DeepSeek Tokenizer (HF) 进行分词
 */
function countTokensDeepSeek(text) {
  const tokenizerPath = path.join(__dirname, '../src/common/utils/tokenizers/deepseek-ai/DeepSeek-V3.2/tokenizer.json');
  if (!fs.existsSync(tokenizerPath)) return -1;

  const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
  const tokenizer = new Tokenizer(tokenizerJson, {});
  return tokenizer.encode(text).ids.length;
}

async function runAdvancedComparison() {
  console.log('='.repeat(70));
  console.log('Kimi Token 深度对比测试：官方 vs 模拟 vs DeepSeek-HF');
  console.log('='.repeat(70));

  // 准备更多样化的测试数据
  const testCases = [
    "Hello world",
    "你好世界",
    "AI is changing the world. 人工智能正在改变世界。",
    "The quick brown fox jumps over the lazy dog. 敏捷的棕色狐狸跳过了那只懒狗。",
    "根据《中华人民共和国民法典》规定，自然人从出生时起到死亡时止，具有民事权利能力，依法享有民事权利，承担民事义务。",
    fs.readFileSync(path.join(__dirname, '../../data/我的室友是幽灵.txt'), 'utf-8').substring(0, 1000)
  ];

  console.log('\n正在执行多方案对比...\n');

  for (let i = 0; i < testCases.length; i++) {
    const text = testCases[i];
    const label = i === 5 ? "长文本片段 (1000字)" : `测试文本 ${i + 1}`;

    try {
      const official = await getKimiTokensPython(text, i);
      const simulated = simulateTokens(text, 1.0, 0.65);
      const deepseekHF = countTokensDeepSeek(text);

      const simDiff = ((simulated - official) / official * 100).toFixed(1);
      const dsDiff = ((deepseekHF - official) / official * 100).toFixed(1);

      console.log(`--- ${label} ---`);
      console.log(`  官方 (Python):   ${official}`);
      console.log(`  模拟 (En1.0/Cn0.65): ${simulated} (${simDiff > 0 ? '+' : ''}${simDiff}%)`);
      console.log(`  DeepSeek (HF):   ${deepseekHF} (${dsDiff > 0 ? '+' : ''}${dsDiff}%)`);
      console.log();
    } catch (err) {
      console.error(`❌ 测试文本 ${i + 1} 失败:`, err.message);
    }
  }
}

runAdvancedComparison();
