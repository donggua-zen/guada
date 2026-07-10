#!/usr/bin/env node
/**
 * Skill Validator — 技能文件校验工具
 *
 * 用法:
 *   node validate-skill.mjs <skill目录路径>
 *
 * 示例:
 *   node validate-skill.mjs ./my-skill
 *   node validate-skill.mjs C:\Users\xxx\.guada\skills\my-skill
 *
 * 校验项:
 *   ✓ SKILL.md 存在
 *   ✓ YAML frontmatter 格式正确
 *   ✓ name 字段（小写字母/数字/连字符，1-64字符，无首尾连字符）
 *   ✓ description 字段（必填，≤1024字符，无尖括号）
 *   ✓ 目录名与 frontmatter name 一致
 *   ✓ 可选字段：version, author, tags, license, compatibility
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

// ============================================================
// 简易 YAML 解析器（无需外部依赖）
// ============================================================

function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split('\n');
  let currentKey = null;
  let currentArray = null;
  let inArray = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // 检测数组行:   - item
    const arrayMatch = line.match(/^\s*-\s+(.+)/);
    if (arrayMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      result[currentKey].push(arrayMatch[1].trim());
      continue;
    }

    // 检测键值对:   key: value
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1].trim();
      let value = kvMatch[2].trim();

      if (value === '' || value === '|' || value === '>') {
        // 多行值或空值开始
        result[currentKey] = '';
        continue;
      }

      if (value.startsWith('[') && value.endsWith(']')) {
        // 内联数组: [a, b, c]
        result[currentKey] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        continue;
      }

      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null' || value === '~') value = null;
      else {
        // 去除引号
        value = value.replace(/^['"]|['"]$/g, '');
      }

      result[currentKey] = value;
      continue;
    }

    // 续行（缩进的行属于上一个键的多行值）
    if (currentKey && line.startsWith(' ')) {
      const trimmed = line.trim();
      if (trimmed) {
        result[currentKey] = (result[currentKey] || '') + (result[currentKey] ? ' ' : '') + trimmed;
      }
    }
  }

  return result;
}

// ============================================================
// 校验核心逻辑
// ============================================================

const ALLOWED_PROPERTIES = new Set([
  'name', 'description', 'version', 'author', 'tags',
  'license', 'compatibility', 'dependencies', 'allowed-tools', 'metadata'
]);

const ALLOWED_DIRS = new Set(['scripts', 'references', 'assets', 'evals', 'agents', 'eval-viewer']);

class ValidationResult {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
    this.errors = [];
    this.warns = [];
  }

  ok(msg) {
    this.passed++;
    return { status: 'ok', msg };
  }

  fail(msg) {
    this.failed++;
    this.errors.push(msg);
    return { status: 'fail', msg };
  }

  warn(msg) {
    this.warnings++;
    this.warns.push(msg);
    return { status: 'warn', msg };
  }

  get total() { return this.passed + this.failed + this.warnings; }

  summary() {
    const parts = [];
    if (this.passed > 0) parts.push(`\x1b[32m${this.passed} passed\x1b[0m`);
    if (this.warnings > 0) parts.push(`\x1b[33m${this.warnings} warnings\x1b[0m`);
    if (this.failed > 0) parts.push(`\x1b[31m${this.failed} failed\x1b[0m`);
    return parts.join(', ');
  }
}

function validateSkill(skillPath) {
  const result = new ValidationResult();
  const skillDir = resolve(skillPath);
  const dirName = basename(skillDir);
  const skillMdPath = join(skillDir, 'SKILL.md');

  console.log(`\n\x1b[1m📋 校验技能: ${dirName}\x1b[0m`);
  console.log(`   路径: ${skillDir}\n`);

  // ---- 1. 检查 SKILL.md 是否存在 ----
  if (!existsSync(skillMdPath)) {
    result.fail(`❌ SKILL.md 不存在: ${skillMdPath}`);
    printResult(result);
    return false;
  }
  result.ok('✅ SKILL.md 存在');

  // ---- 2. 读取并解析 frontmatter ----
  const content = readFileSync(skillMdPath, 'utf-8');

  if (!content.startsWith('---')) {
    result.fail('❌ 文件必须以 "---" 开头（YAML frontmatter）');
    printResult(result);
    return false;
  }

  // 分离 frontmatter 和正文
  const bodyMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!bodyMatch) {
    result.fail('❌ frontmatter 格式错误：未找到闭合的 "---"');
    printResult(result);
    return false;
  }

  const frontmatterText = bodyMatch[1];
  const bodyContent = bodyMatch[2];
  result.ok('✅ YAML frontmatter 分隔符正确');

  // ---- 3. 解析 frontmatter ----
  let frontmatter;
  try {
    frontmatter = parseSimpleYaml(frontmatterText);
    if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) {
      result.fail('❌ frontmatter 必须是一个 YAML 对象（键值对）');
      printResult(result);
      return false;
    }
  } catch (e) {
    result.fail(`❌ frontmatter 解析失败: ${e.message}`);
    printResult(result);
    return false;
  }
  result.ok('✅ YAML frontmatter 解析成功');

  // ---- 4. 检查未允许的属性 ----
  const unexpected = Object.keys(frontmatter).filter(k => !ALLOWED_PROPERTIES.has(k));
  if (unexpected.length > 0) {
    for (const key of unexpected) {
      result.warn(`⚠️  frontmatter 中存在未列出的属性: "${key}"（允许: ${[...ALLOWED_PROPERTIES].join(', ')}）`);
    }
  }

  // ---- 5. 检查 name 字段 ----
  const name = frontmatter.name;
  if (!name) {
    result.fail('❌ name 字段缺失');
  } else if (typeof name !== 'string') {
    result.fail(`❌ name 必须是字符串，当前类型: ${typeof name}`);
  } else {
    const nameStr = name.trim();
    if (nameStr.length === 0) {
      result.fail('❌ name 不能为空');
    } else {
      if (nameStr.length > 64) {
        result.fail(`❌ name 过长（${nameStr.length} 字符），最大 64 字符`);
      } else {
        result.ok(`✅ name 长度 ${nameStr.length} 字符（≤64）`);
      }

      if (!/^[a-z0-9-]+$/.test(nameStr)) {
        result.fail('❌ name 只能包含小写字母、数字和连字符（[a-z0-9-]）');
      } else {
        result.ok('✅ name 字符合规（仅小写字母/数字/连字符）');
      }

      if (/^-|-$|--/.test(nameStr)) {
        result.fail('❌ name 不能以连字符开头/结尾，也不能包含连续连字符');
      } else {
        result.ok('✅ name 首尾和连字符格式合规');
      }

      // 检查目录名是否匹配
      if (nameStr !== dirName) {
        result.fail(`❌ 目录名 "${dirName}" 与 frontmatter name "${nameStr}" 不匹配`);
      } else {
        result.ok(`✅ 目录名与 frontmatter name 一致 ("${nameStr}")`);
      }
    }
  }

  // ---- 6. 检查 description 字段 ----
  const desc = frontmatter.description;
  if (!desc) {
    result.fail('❌ description 字段缺失');
  } else if (typeof desc !== 'string') {
    result.fail(`❌ description 必须是字符串，当前类型: ${typeof desc}`);
  } else {
    const descStr = desc.trim();
    if (descStr.length === 0) {
      result.fail('❌ description 不能为空');
    } else {
      if (descStr.length > 1024) {
        result.fail(`❌ description 过长（${descStr.length} 字符），最大 1024 字符`);
      } else {
        result.ok(`✅ description 长度 ${descStr.length} 字符（≤1024）`);
      }

      if (/[<>]/.test(descStr)) {
        result.fail('❌ description 不能包含尖括号（< 或 >）');
      } else {
        result.ok('✅ description 无尖括号');
      }
    }
  }

  // ---- 7. 检查可选字段 ----
  if (frontmatter.version !== undefined) {
    const v = String(frontmatter.version);
    if (/^\d+\.\d+\.\d+$/.test(v)) {
      result.ok(`✅ version "${v}" 格式合规（semver）`);
    } else {
      result.warn(`⚠️  version "${v}" 不是标准 semver 格式（推荐: x.y.z）`);
    }
  }

  if (frontmatter.author !== undefined) {
    result.ok(`✅ author: "${frontmatter.author}"`);
  }

  if (frontmatter.tags !== undefined) {
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
    if (tags.length > 0) {
      result.ok(`✅ tags: ${tags.join(', ')}`);
    } else {
      result.warn('⚠️  tags 为空数组');
    }
  }

  if (frontmatter.license !== undefined) {
    result.ok(`✅ license: "${frontmatter.license}"`);
  }

  if (frontmatter.compatibility !== undefined) {
    const compat = String(frontmatter.compatibility);
    if (compat.length > 500) {
      result.fail(`❌ compatibility 过长（${compat.length} 字符），最大 500 字符`);
    } else {
      result.ok(`✅ compatibility: ${compat.length} 字符（≤500）`);
    }
  }

  // ---- 8. 检查正文内容 ----
  if (bodyContent.trim().length === 0) {
    result.warn('⚠️  SKILL.md 正文为空');
  } else {
    const lineCount = bodyContent.split('\n').length;
    result.ok(`✅ 正文 ${lineCount} 行`);

    if (lineCount > 500) {
      result.warn(`⚠️  正文 ${lineCount} 行，超过 500 行建议拆分到 references/ 目录`);
    }
  }

  // ---- 9. 检查目录结构 ----
  let dirItems = [];
  try {
    dirItems = readdirSync(skillDir);
  } catch (e) {
    result.warn(`⚠️  无法读取目录结构: ${e.message}`);
  }

  const extraDirs = dirItems.filter(item => {
    const fullPath = join(skillDir, item);
    return statSync(fullPath).isDirectory() && !ALLOWED_DIRS.has(item) && !item.startsWith('.');
  });

  if (extraDirs.length > 0) {
    for (const d of extraDirs) {
      result.warn(`⚠️  非标准子目录: "${d}"（标准: scripts/, references/, assets/, evals/, agents/）`);
    }
  }

  // 检查 scripts/ 下是否有可执行文件
  const scriptsDir = join(skillDir, 'scripts');
  if (existsSync(scriptsDir)) {
    const scripts = readdirSync(scriptsDir).filter(f => f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.sh'));
    result.ok(`✅ scripts/ 目录: ${scripts.length} 个脚本`);
  }

  // ---- 输出结果 ----
  printResult(result);
  return result.failed === 0;
}

function printResult(result) {
  console.log('\n' + '='.repeat(50));
  console.log(`📊 校验结果: ${result.summary()}`);
  console.log('='.repeat(50));

  if (result.warns.length > 0) {
    console.log(`\n\x1b[33m⚠️  警告（${result.warnings}）:\x1b[0m`);
    for (const w of result.warns) {
      console.log(`   ${w}`);
    }
  }

  if (result.errors.length > 0) {
    console.log(`\n\x1b[31m❌ 错误（${result.failed}）:\x1b[0m`);
    for (const e of result.errors) {
      console.log(`   ${e}`);
    }
  }

  if (result.failed === 0) {
    console.log(`\n\x1b[32m✅ 校验通过！技能文件合规 🎉\x1b[0m`);
  } else {
    console.log(`\n\x1b[31m❌ 校验未通过，请修复上述错误后重试\x1b[0m`);
  }
}

// ============================================================
// CLI 入口
// ============================================================

function printUsage() {
  console.log(`
用法: node validate-skill.mjs <skill目录路径>

示例:
  node validate-skill.mjs ./my-skill
  node validate-skill.mjs C:\\Users\\xxx\\.guada\\skills\\my-skill
  node validate-skill.mjs .  (校验当前目录)
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const targetPath = args[0];
  const resolvedPath = resolve(targetPath);

  if (!existsSync(resolvedPath)) {
    console.error(`\x1b[31m错误: 路径不存在: ${resolvedPath}\x1b[0m`);
    process.exit(1);
  }

  if (!statSync(resolvedPath).isDirectory()) {
    console.error(`\x1b[31m错误: 路径不是目录: ${resolvedPath}\x1b[0m`);
    process.exit(1);
  }

  const isValid = validateSkill(resolvedPath);
  process.exit(isValid ? 0 : 1);
}

main();