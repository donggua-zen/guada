const { Tokenizer } = require('@huggingface/tokenizers');
const path = require('path');
const fs = require('fs');

// 尝试加载 tiktoken（如果可用）
let tiktoken;
try {
  tiktoken = require('tiktoken');
} catch (e) {
  console.log('⚠️  tiktoken 未安装，将跳过 tiktoken 对比测试\n');
}

/**
 * 读取 docs 目录下的所有文本文件以及 data 目录下的 txt 文件
 */
function loadTestDocuments() {
  const docsDir = path.join(__dirname, '../../docs');
  const dataDir = path.join(__dirname, '../../data');
  const documents = [];

  // 读取 docs 目录下的 Markdown 文件
  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(docsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      documents.push({
        name: file,
        content: content,
        charCount: content.length,
        type: '中英混合',
      });
    }
  } else {
    console.error(`⚠️  docs 目录不存在: ${docsDir}`);
  }

  // 读取 data 目录下的 TXT 文件
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.txt'));
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      documents.push({
        name: file,
        content: content,
        charCount: content.length,
        type: '纯中文',
      });
    }
  } else {
    console.error(`⚠️  data 目录不存在: ${dataDir}`);
  }

  return documents;
}

/**
 * 使用 HuggingFace Tokenizer 计算 Token 数（带性能监控）
 */
function countTokensHF(modelName, text, cache = {}) {
  const tokenizerPath = path.join(__dirname, `../src/common/utils/tokenizer/${modelName}.json`);

  if (!fs.existsSync(tokenizerPath)) {
    throw new Error(`Tokenizer file not found: ${tokenizerPath}`);
  }

  let tokenizer;
  let initTime = 0;

  // 检查缓存
  if (cache[modelName]) {
    tokenizer = cache[modelName];
  } else {
    // 首次加载：读取文件并实例化
    const start = Date.now();
    const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
    tokenizer = new Tokenizer(tokenizerJson, {});
    initTime = Date.now() - start;
    cache[modelName] = tokenizer; // 存入缓存
  }

  // 统计编码耗时
  const encodeStart = Date.now();
  const encoded = tokenizer.encode(text);
  const encodeTime = Date.now() - encodeStart;

  return {
    tokens: encoded.ids.length,
    initTime,
    encodeTime,
  };
}

/**
 * 使用 Tiktoken 计算 Token 数（带缓存机制）
 */
function countTokensTiktoken(encodingName, text, cache = {}) {
  if (!tiktoken) {
    throw new Error('tiktoken not available');
  }

  let enc;
  let initTime = 0;

  // 检查缓存
  if (cache[encodingName]) {
    enc = cache[encodingName];
  } else {
    // 首次加载：获取编码器
    const start = Date.now();
    enc = tiktoken.get_encoding(encodingName);
    initTime = Date.now() - start;
    cache[encodingName] = enc; // 存入缓存
  }

  // 统计编码耗时
  const encodeStart = Date.now();
  const tokens = enc.encode(text);
  const encodeTime = Date.now() - encodeStart;

  return {
    tokens: tokens.length,
    initTime,
    encodeTime,
  };
}

/**
 * 运行对比测试
 */
async function runComparisonTest() {
  console.log('='.repeat(80));
  console.log('Token 分割对比测试：HuggingFace Tokenizers vs Tiktoken');
  console.log('='.repeat(80));
  console.log();

  // 加载测试文档
  const documents = loadTestDocuments();
  if (documents.length === 0) {
    console.error('❌ 没有找到测试文档');
    return;
  }

  console.log(`📄 加载了 ${documents.length} 个测试文档:\n`);
  documents.forEach((doc, idx) => {
    console.log(`  ${idx + 1}. ${doc.name} (${doc.charCount.toLocaleString()} 字符) [${doc.type}]`);
  });
  console.log();

  // 定义测试配置
  const testConfigs = [
    {
      name: 'Qwen3',
      hfModel: 'qwen3',
      tiktokenEncoding: 'cl100k_base',
    },
    {
      name: 'DeepSeek',
      hfModel: 'deepseek',
      tiktokenEncoding: 'cl100k_base',
    },
    {
      name: 'GLM-4',
      hfModel: 'GLM-4.6',
      tiktokenEncoding: 'cl100k_base',
    },
  ];

  // 对每个文档进行测试
  const hfCache = {}; // 用于复用 HuggingFace Tokenizer 实例
  const ttCache = {}; // 用于复用 Tiktoken 编码器实例
  for (const doc of documents) {
    console.log('-'.repeat(80));
    console.log(`📝 文档: ${doc.name} [${doc.type}]`);
    console.log(`   字符数: ${doc.charCount.toLocaleString()}`);
    console.log('-'.repeat(80));

    const results = [];

    for (const config of testConfigs) {
      const result = {
        model: config.name,
        hfTokens: null,
        tiktokenTokens: null,
        diff: null,
        diffPercent: null,
        hfInitTime: 0,
        hfEncodeTime: 0,
        ttInitTime: 0,
        ttEncodeTime: 0,
      };

      try {
        // HuggingFace Tokenizer
        const hfResult = countTokensHF(config.hfModel, doc.content, hfCache);
        result.hfTokens = hfResult.tokens;
        result.hfInitTime = hfResult.initTime;
        result.hfEncodeTime = hfResult.encodeTime;

        // Tiktoken
        if (tiktoken) {
          const ttResult = countTokensTiktoken(config.tiktokenEncoding, doc.content, ttCache);
          result.tiktokenTokens = ttResult.tokens;
          result.ttInitTime = ttResult.initTime;
          result.ttEncodeTime = ttResult.encodeTime;

          result.diff = result.hfTokens - result.tiktokenTokens;
          result.diffPercent = ((result.diff / result.tiktokenTokens) * 100).toFixed(2);

          console.log(`\n  ${config.name}:`);
          console.log(`    HF Tokens:    ${result.hfTokens.toLocaleString()} (初始化: ${result.hfInitTime}ms, 编码: ${result.hfEncodeTime}ms)`);
          console.log(`    Tiktoken:     ${result.tiktokenTokens.toLocaleString()} (初始化: ${result.ttInitTime}ms, 编码: ${result.ttEncodeTime}ms)`);
          console.log(`    差异:         ${result.diff > 0 ? '+' : ''}${result.diff} (${result.diffPercent}%)`);
        } else {
          console.log(`\n  ${config.name}:`);
          console.log(`    HF Tokens:    ${result.hfTokens.toLocaleString()} (初始化: ${result.hfInitTime}ms, 编码: ${result.hfEncodeTime}ms)`);
          console.log(`    Tiktoken:     不可用`);
        }

        results.push(result);
      } catch (error) {
        console.error(`    ❌ ${config.model} 测试失败:`, error.message);
      }
    }

    console.log();
  }

  // 总结统计
  console.log('='.repeat(80));
  console.log('📊 总结统计');
  console.log('='.repeat(80));

  if (tiktoken) {
    for (const config of testConfigs) {
      const modelResults = [];
      let totalHfInitTime = 0;
      let totalHfEncodeTime = 0;
      let totalTtInitTime = 0;
      let totalTtEncodeTime = 0;

      for (const doc of documents) {
        try {
          const hfResult = countTokensHF(config.hfModel, doc.content, hfCache);
          const ttResult = countTokensTiktoken(config.tiktokenEncoding, doc.content, ttCache);

          modelResults.push({
            hfTokens: hfResult.tokens,
            ttTokens: ttResult.tokens,
            diff: hfResult.tokens - ttResult.tokens,
            hfInitTime: hfResult.initTime,
            hfEncodeTime: hfResult.encodeTime,
            ttInitTime: ttResult.initTime,
            ttEncodeTime: ttResult.encodeTime
          });

          totalHfInitTime += hfResult.initTime;
          totalHfEncodeTime += hfResult.encodeTime;
          totalTtInitTime += ttResult.initTime;
          totalTtEncodeTime += ttResult.encodeTime;
        } catch (e) {
          // 跳过错误的
        }
      }

      if (modelResults.length > 0) {
        const avgDiff = modelResults.reduce((sum, r) => sum + r.diff, 0) / modelResults.length;
        const maxDiff = Math.max(...modelResults.map(r => Math.abs(r.diff)));
        const totalHf = modelResults.reduce((sum, r) => sum + r.hfTokens, 0);
        const totalTt = modelResults.reduce((sum, r) => sum + r.ttTokens, 0);
        const overallDiffPercent = (((totalHf - totalTt) / totalTt) * 100).toFixed(2);
        const avgHfEncodeTime = totalHfEncodeTime / modelResults.length;
        const avgTtEncodeTime = totalTtEncodeTime / modelResults.length;

        console.log(`\n${config.name}:`);
        console.log(`  平均差异:     ${avgDiff > 0 ? '+' : ''}${avgDiff.toFixed(2)} tokens`);
        console.log(`  最大差异:     ${maxDiff} tokens`);
        console.log(`  总体差异:     ${overallDiffPercent}%`);
        console.log(`  平均编码耗时: HF=${avgHfEncodeTime.toFixed(2)}ms, TT=${avgTtEncodeTime.toFixed(2)}ms (复用实例后)`);
        console.log(`  结论:         ${Math.abs(parseFloat(overallDiffPercent)) < 1 ? '✅ 基本一致' : '⚠️  存在差异'}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ 测试完成');
  console.log('='.repeat(80));
}

runComparisonTest().catch(console.error);
