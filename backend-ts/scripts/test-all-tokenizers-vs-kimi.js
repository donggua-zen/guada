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
 * 扫描所有可用的 HF Tokenizer 并进行对比
 */
async function findBestTokenizerMatch() {
  console.log('='.repeat(70));
  console.log('正在遍历所有分词器，寻找与 Kimi 最接近的模型...');
  console.log('='.repeat(70));

  const tokenizersDir = path.join(__dirname, '../src/common/utils/tokenizers');
  const tokenizerFiles = [];

  // 递归查找所有 tokenizer.json
  function findTokenizers(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        findTokenizers(fullPath);
      } else if (file === 'tokenizer.json') {
        tokenizerFiles.push(fullPath);
      }
    }
  }
  findTokenizers(tokenizersDir);

  // 准备测试文本
  const chineseText = fs.readFileSync(path.join(__dirname, '../../data/我的室友是幽灵.txt'), 'utf-8');
  const mixedText = fs.readFileSync(path.join(__dirname, '../src/common/utils/tokenizer.service.ts'), 'utf-8'); // 使用代码文件作为中英混合示例

  console.log(`\n正在执行多场景对比测试...`);
  console.log(`1. 纯中文长文本: ${chineseText.length} 字符`);
  console.log(`2. 中英混合文档: ${mixedText.length} 字符\n`);

  const testCases = [
    { name: "纯中文小说 (全本)", text: chineseText },
    { name: "中英混合代码", text: mixedText }
  ];

  for (const testCase of testCases) {
    console.log('-'.repeat(70));
    console.log(`📄 测试场景: ${testCase.name}`);

    const officialTokens = await getKimiTokensPython(testCase.text, 999);
    console.log(`Kimi 官方基准: ${officialTokens} Tokens\n`);

    const results = [];
    for (const tfPath of tokenizerFiles) {
      try {
        const parts = tfPath.split(path.sep);
        const modelName = parts.slice(parts.indexOf('tokenizers') + 1).join('/').replace('/tokenizer.json', '');

        const start = Date.now();
        const json = JSON.parse(fs.readFileSync(tfPath, 'utf-8'));
        const tokenizer = new Tokenizer(json, {});
        const count = tokenizer.encode(testCase.text).ids.length;
        const time = Date.now() - start;

        const diff = count - officialTokens;
        const diffPercent = (diff / officialTokens * 100).toFixed(2);

        results.push({
          model: modelName,
          tokens: count,
          diff: diff,
          diffPercent: parseFloat(diffPercent),
          time: time
        });
      } catch (e) {
        // 忽略错误
      }
    }

    results.sort((a, b) => Math.abs(a.diffPercent) - Math.abs(b.diffPercent));

    console.log('排名 | 模型名称                               | Tokens | 差异   | 耗时');
    console.log('-'.repeat(70));

    results.forEach((r, index) => {
      const mark = index === 0 ? '🏆' : (index < 3 ? '✨' : '  ');
      console.log(`${mark} ${index + 1}. ${r.model.padEnd(35)} | ${r.tokens.toString().padStart(6)} | ${r.diff > 0 ? '+' : ''}${r.diffPercent.toFixed(2).padStart(6)}% | ${r.time}ms`);
    });
    console.log();
  }
}

findBestTokenizerMatch();
