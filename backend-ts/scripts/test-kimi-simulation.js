const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 调用 Python 脚本获取 Kimi 官方 Token 数
 */
function getKimiTokensPython(text, index) {
  return new Promise((resolve, reject) => {
    // 将文本写入临时文件，避免命令行参数过长或编码问题
    const tempFile = path.join(__dirname, `temp_kimi_input_${index}.txt`);
    fs.writeFileSync(tempFile, text, 'utf-8');

    const scriptPath = path.join(__dirname, 'kimi_counter.py');
    const pythonPath = 'C:\\Users\\22071\\AppData\\Local\\Programs\\Python\\Python313\\python.exe';

    const utilsDir = path.join(__dirname, '../src/common/utils');
    const modelPath = path.join(__dirname, '../src/common/utils/tokenizers/moonshotai/Kimi-K2.5/tiktoken.model');
    const configPath = path.join(__dirname, '../src/common/utils/tokenizers/moonshotai/Kimi-K2.5/tokenizer_config.json');

    // 使用参数传递路径，避免命令行转义问题
    const cmd = `${pythonPath} "${scriptPath}" "${utilsDir}" "${modelPath}" "${configPath}" "${tempFile}"`;

    exec(cmd, { encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); // 清理临时文件

      // 过滤掉 transformers 的警告信息，只保留真正的错误
      const realError = stderr && !stderr.includes('None of PyTorch');

      if (error || realError) {
        console.error('Python 执行错误:', stderr);
        reject(error || new Error(stderr));
      } else {
        const output = stdout.trim();
        console.log(`[Debug] Python Output for index ${index}: "${output}"`);
        const result = parseInt(output);
        if (isNaN(result)) {
          reject(new Error(`Python 返回了非数字结果: "${output}"`));
        } else {
          resolve(result);
        }
      }
    });
  });
}

/**
 * 模拟算法：英文单词数 * 权重 + 中文字符数 * 权重
 * 根据官方描述，中文系数调整为 0.65 (即 1 Token ≈ 1.54 汉字)
 */
function simulateTokens(text, enWeight = 1.3, cnWeight = 0.65) {
  // 提取英文单词（连续字母）
  const enWords = text.match(/[a-zA-Z0-9]+/g) || [];
  const enCount = enWords.length;

  // 提取中文字符
  const cnChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const cnCount = cnChars.length;

  // 其他字符（标点、空格等）简单按字符数算，权重给低一点
  const otherCount = text.length - enWords.join('').length - cnCount;

  return Math.ceil(enCount * enWeight + cnCount * cnWeight + otherCount * 0.5);
}

async function runComparison() {
  console.log('='.repeat(60));
  console.log('Kimi Token 模拟算法对比测试');
  console.log('='.repeat(60));

  const testCases = [
    "Hello, world!",
    "你好，世界！",
    "这是一个中英混合的测试文本：AI Chat System v1.0",
    fs.readFileSync(path.join(__dirname, '../../data/我的室友是幽灵.txt'), 'utf-8').substring(0, 500)
  ];

  console.log('\n正在通过 Python 获取官方基准数据...\n');

  for (let i = 0; i < testCases.length; i++) {
    const text = testCases[i];
    const label = i === 3 ? "长文本片段 (500字)" : `测试文本 ${i + 1}`;

    try {
      const officialTokens = await getKimiTokensPython(text, i);
      const simulatedTokens = simulateTokens(text);
      const o200kTokens = 0; // 这里可以集成之前的 tiktoken 逻辑

      const diff = simulatedTokens - officialTokens;
      const diffPercent = ((diff / officialTokens) * 100).toFixed(2);

      console.log(`--- ${label} ---`);
      console.log(`  官方 (Python): ${officialTokens}`);
      console.log(`  模拟算法:      ${simulatedTokens} (差异: ${diff > 0 ? '+' : ''}${diffPercent}%)`);
      console.log();
    } catch (err) {
      console.error(`❌ 测试文本 ${i + 1} 失败:`, err.message);
    }
  }
}

runComparison();
