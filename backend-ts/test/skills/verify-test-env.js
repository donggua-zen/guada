#!/usr/bin/env node

/**
 * Skills 测试环境验证脚本
 * 
 * 检查测试所需的所有依赖和环境是否正确配置
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Skills 测试环境验证\n');

let hasError = false;

// 1. 检查 Node.js 版本
console.log('1️⃣  检查 Node.js 版本...');
try {
  const nodeVersion = process.version;
  console.log(`   ✅ Node.js ${nodeVersion}`);
} catch (error) {
  console.log('   ❌ Node.js 未安装');
  hasError = true;
}

// 2. 检查 npm
console.log('\n2️⃣  检查 npm...');
try {
  const npmVersion = execSync('npm --version').toString().trim();
  console.log(`   ✅ npm ${npmVersion}`);
} catch (error) {
  console.log('   ❌ npm 未安装');
  hasError = true;
}

// 3. 检查 Python（脚本执行需要）
console.log('\n3️⃣  检查 Python...');
try {
  const pythonVersion = execSync('python --version', { stdio: 'pipe' }).toString().trim();
  console.log(`   ✅ ${pythonVersion}`);
} catch (error) {
  try {
    const pythonVersion = execSync('python3 --version', { stdio: 'pipe' }).toString().trim();
    console.log(`   ✅ ${pythonVersion}`);
  } catch (error) {
    console.log('   ⚠️  Python 未找到（脚本执行测试将失败）');
  }
}

// 4. 检查测试目录结构
console.log('\n4️⃣  检查测试目录结构...');
const testDir = path.join(__dirname);
const fixturesDir = path.join(testDir, 'fixtures', 'skills');

const requiredDirs = [
  testDir,
  fixturesDir,
  path.join(fixturesDir, 'test-skill-alpha'),
  path.join(fixturesDir, 'test-skill-beta', 'scripts'),
];

for (const dir of requiredDirs) {
  if (fs.existsSync(dir)) {
    console.log(`   ✅ ${path.relative(__dirname, dir)}`);
  } else {
    console.log(`   ❌ ${path.relative(__dirname, dir)} 不存在`);
    hasError = true;
  }
}

// 5. 检查测试文件
console.log('\n5️⃣  检查测试文件...');
const requiredFiles = [
  'skill-loader.service.spec.ts',
  'skill-registry.service.spec.ts',
  'skill-script-executor.spec.ts',
  'skill-orchestrator.integration.spec.ts',
  'jest-global.d.ts',
];

for (const file of requiredFiles) {
  const filePath = path.join(testDir, file.includes('jest') ? '' : '', file);
  const fullPath = file.includes('jest') 
    ? path.join(testDir, '..', 'jest-global.d.ts')
    : path.join(testDir, file);
  
  if (fs.existsSync(fullPath)) {
    console.log(`   ✅ ${file}`);
  } else {
    console.log(`   ❌ ${file} 不存在`);
    hasError = true;
  }
}

// 6. 检查测试 Fixtures
console.log('\n6️⃣  检查测试 Fixtures...');
const fixtureFiles = [
  path.join(fixturesDir, 'test-skill-alpha', 'SKILL.md'),
  path.join(fixturesDir, 'test-skill-beta', 'SKILL.md'),
  path.join(fixturesDir, 'test-skill-beta', 'scripts', 'hello.py'),
];

for (const file of fixtureFiles) {
  if (fs.existsSync(file)) {
    console.log(`   ✅ ${path.relative(testDir, file)}`);
  } else {
    console.log(`   ❌ ${path.relative(testDir, file)} 不存在`);
    hasError = true;
  }
}

// 7. 检查 package.json 中的测试脚本
console.log('\n7️⃣  检查 package.json 测试配置...');
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  if (packageJson.scripts && packageJson.scripts.test) {
    console.log(`   ✅ test 脚本: ${packageJson.scripts.test}`);
  } else {
    console.log('   ⚠️  package.json 中未找到 test 脚本');
  }
  
  // 检查 Jest 依赖
  const jestDeps = ['jest', '@nestjs/testing', '@types/jest'];
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  
  for (const dep of jestDeps) {
    if (allDeps[dep]) {
      console.log(`   ✅ ${dep}: ${allDeps[dep]}`);
    } else {
      console.log(`   ⚠️  ${dep} 未安装`);
    }
  }
} else {
  console.log('   ❌ package.json 不存在');
  hasError = true;
}

// 总结
console.log('\n' + '='.repeat(50));
if (hasError) {
  console.log('❌ 验证失败，请修复上述问题后重试');
  process.exit(1);
} else {
  console.log('✅ 所有检查通过！可以运行测试了');
  console.log('\n💡 快速开始:');
  console.log('   npm test -- test/skills');
  console.log('   或');
  console.log('   .\\test-skills.bat');
  console.log('='.repeat(50));
  process.exit(0);
}
