/**
 * 一次性 codemod：类型类瘦身
 * - implements IModelProvider → extends ProviderTypeCatalog
 * - 删除 adapter 字段/构造器/getAdapter 方法
 * - 删除 getModelThinkingEfforts 方法（档位规则已数据化为 YAML）
 * - defaultThinkingEfforts → readonly thinking = { defaultEfforts } as const
 * 运行：node scripts/slim-provider-catalogs.cjs
 */
const fs = require('fs');
const path = require('path');

const PROVIDERS_DIR = path.resolve(__dirname, '../src/modules/llm-core/providers');

const STYLE_BY_TYPE = {
  moonshot: 'enable-thinking',
  'baidu-qianfan': 'enable-thinking',
  'aliyun-bailian': 'enable-thinking',
  siliconflow: 'enable-thinking',
  minimax: 'reasoning-split',
};

const FILES = [
  'openai-response/openai-response.provider.ts',
  'anthropic/anthropic.provider.ts',
  'google/google.provider.ts',
  'azure-openai/azure-openai.provider.ts',
  'moonshot/moonshot.provider.ts',
  'zhipu/zhipu.provider.ts',
  'aliyun-bailian/aliyun-bailian.provider.ts',
  'baidu-qianfan/baidu-qianfan.provider.ts',
  'minimax/minimax.provider.ts',
  'groq/groq.provider.ts',
  'siliconflow/siliconflow.provider.ts',
  'xqapi/xqapi.provider.ts',
  'custom/custom.provider.ts',
  'mock/mock.provider.ts',
];

/** 从 startLine 行的方法开头做括号深度扫描，返回方法块结束行号（含） */
function findBlockEnd(lines, startLine) {
  let depth = 0;
  let started = false;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') { depth--; }
    }
    if (started && depth === 0) return i;
  }
  throw new Error(`Unbalanced braces from line ${startLine}`);
}

/** 找到方法块上方的连续注释块起始行 */
function findCommentStart(lines, methodLine) {
  let i = methodLine - 1;
  while (i >= 0 && lines[i].trim().endsWith('*/') === false && lines[i].trim().startsWith('//')) {
    i--;
  }
  if (i >= 0 && lines[i].trim().endsWith('*/')) {
    // JSDoc：向上找 /**
    while (i >= 0 && !lines[i].includes('/**')) i--;
    return i;
  }
  return methodLine;
}

function processFile(relPath, typeId) {
  const filePath = path.join(PROVIDERS_DIR, relPath);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. 删除 adapter 相关 import
  content = content
    .split('\n')
    .filter((line) => {
      if (/^import \{ IProtocolAdapter \}/.test(line)) return false;
      if (/^import \{ [^}]*Adapter(, )?[^}]*\} from/.test(line) && /adapter/i.test(line)) {
        // 排除 provider-type-catalog（无 Adapter 字样）——此规则只匹配真 adapter import
        return false;
      }
      return true;
    })
    .join('\n');

  // 2. types import 去掉 IModelProvider
  content = content.replace(/import \{ IModelProvider, ProviderMetadata/, 'import { ProviderMetadata');
  content = content.replace(/import \{([^}]*)IModelProvider,?\s*([^}]*)\} from '([^']*provider\.types)'/, (m, a, b, c) => {
    const merged = (a + b).replace(/,\s*$/, '').trim();
    return `import { ${merged} } from '${c}'`;
  });

  // 3. 插入 catalog 基类 import
  content = content.replace(
    /(import \{[^}]*\} from '\.\.\/\.\.\/types\/provider\.types';)/,
    "$1\nimport { ProviderTypeCatalog } from '../provider-type-catalog';",
  );

  // 4. 继承
  content = content.replace(' implements IModelProvider {', ' extends ProviderTypeCatalog {');

  // 5. defaultThinkingEfforts → readonly thinking
  const style = STYLE_BY_TYPE[typeId];
  content = content.replace(
    /(\s*)(?:\/\/[^\n]*\n)*\s*private defaultThinkingEfforts: string\[\] = (\[[\s\S]*?\]);/,
    (m, indent, arr) => {
      const styleLine = style ? `style: '${style}',\n${indent}  ` : '';
      return `${indent}// 类型级 thinking 声明（实例 YAML thinking 块缺省时的回退）\n${indent}readonly thinking = {\n${indent}  ${styleLine}defaultEfforts: ${arr.replace(/\n\s*/g, '\n' + indent + '  ')},\n${indent}} as const;`;
    },
  );

  // 6. 行级处理：删除 adapter 字段/构造器/方法
  const lines = content.split('\n');
  const drop = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(private|readonly)?\s*(openaiAdapter|responseAdapter|adapter|openAIAdapter|anthropicAdapter|geminiAdapter|mockAdapter)\s*[:=]/.test(line)) {
      drop.add(i);
      // 构造器块
      for (let j = i + 1; j < lines.length; j++) {
        if (/constructor\s*\(/.test(lines[j])) {
          const end = findBlockEnd(lines, j);
          // 连带构造器上方的注释
          const cStart = findCommentStart(lines, j);
          for (let k = cStart; k <= end; k++) drop.add(k);
          break;
        }
        // 字段连续多行声明
        drop.add(j);
        if (/;\s*$/.test(lines[j])) break;
      }
    }
    if (/getAdapter\s*\(/.test(line)) {
      const end = findBlockEnd(lines, i);
      const cStart = findCommentStart(lines, i);
      for (let k = cStart; k <= end; k++) drop.add(k);
    }
    if (/getModelThinkingEfforts\s*\(/.test(line)) {
      const end = findBlockEnd(lines, i);
      const cStart = findCommentStart(lines, i);
      for (let k = cStart; k <= end; k++) drop.add(k);
    }
  }
  content = lines.filter((_, i) => !drop.has(i)).join('\n');

  // 7. 清理多余空行（3+ → 1）
  content = content.replace(/\n{3,}/g, '\n\n');

  if (content === original) {
    console.warn(`WARN no change: ${relPath}`);
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`slimmed ${relPath}`);
}

for (const rel of FILES) {
  const typeId = rel.split('/')[0];
  processFile(rel, typeId);
}
console.log('done');
