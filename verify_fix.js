#!/usr/bin/env node

/**
 * 思考时长修复验证脚本
 * 
 * 该脚本检查所有修复是否正确应用：
 * 1. 后端日志是否添加
 * 2. 前端显示逻辑是否修改
 * 3. 历史数据回填逻辑是否强制覆盖
 */

const fs = require('fs');
const path = require('path');

// 颜色定义
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

let checksPassed = 0;
let checksFailed = 0;

function checkFile(filePath, checks) {
  const fullPath = path.join(__dirname, filePath);
  
  console.log(`\n${colors.blue}检查文件：${filePath}${colors.reset}`);
  console.log('='.repeat(50));
  
  if (!fs.existsSync(fullPath)) {
    console.log(`${colors.red}✗ 文件不存在${colors.reset}`);
    checksFailed++;
    return;
  }
  
  const content = fs.readFileSync(fullPath, 'utf-8');
  
  checks.forEach(([pattern, description]) => {
    const regex = new RegExp(pattern);
    if (regex.test(content)) {
      console.log(`${colors.green}✓${colors.reset} ${description}`);
      checksPassed++;
    } else {
      console.log(`${colors.red}✗${colors.reset} ${description}`);
      checksFailed++;
    }
  });
}

// 执行检查
console.log(`${colors.blue}╔════════════════════════════════════════════╗`);
console.log('║   思考时长 Bug 修复验证                   ║');
console.log('╚════════════════════════════════════════════╝${colors.reset}\n');

// 检查后端文件
checkFile('backend/app/services/agent_service.py', [
  ['logger\\.info\\(f"Thinking duration calculated', '后端：记录计算出的思考时长'],
  ['logger\\.info\\(f"Thinking duration saved', '后端：记录保存到 meta_data'],
  ['logger\\.warning.*Thinking timestamps not found', '后端：时间戳缺失警告'],
  ['message_content\\.meta_data\\["thinking_duration_ms"\\]', '后端：保存到 meta_data 字段']
]);

// 检查前端 MessageItem.vue
checkFile('frontend/src/components/MessageItem.vue', [
  ['const getThinkingDuration = \\(turn\\)', '前端：getThinkingDuration 函数定义'],
  ['turn\\.meta_data\\?\\.thinking_duration_ms', '前端：从 meta_data 读取时长'],
  ['if \\(turn\\.state\\?\\.is_thinking\\)', '前端：区分思考中状态'],
  ['getThinkingDuration\\(turn\\)', '前端：使用 getThinkingDuration 函数']
]);

// 检查前端 ChatPanel.vue
checkFile('frontend/src/components/ChatPanel.vue', [
  ['content\\.thinking_duration_ms = content\\.meta_data\\.thinking_duration_ms', '前端：强制覆盖为后端值'],
  ['_thinkingTimer', '前端：计时器变量'],
  ['setInterval', '前端：启动计时器'],
  ['clearInterval', '前端：清除计时器']
]);

// 输出结果
console.log('\n' + '='.repeat(50));
console.log(`${colors.blue}验证结果汇总${colors.reset}`);
console.log('='.repeat(50));
console.log(`${colors.green}通过：${checksPassed}${colors.reset}`);
console.log(`${colors.red}失败：${checksFailed}${colors.reset}`);
console.log('');

if (checksFailed === 0) {
  console.log(`${colors.green}✓ 所有检查通过！代码修复已正确应用${colors.reset}\n`);
  console.log(`${colors.yellow}下一步操作：${colors.reset}`);
  console.log('1. 启动后端服务：cd backend && python -m uvicorn app.main:app --reload');
  console.log('2. 启动前端服务：cd frontend && npm run dev');
  console.log('3. 访问 http://localhost:5173 测试功能');
  console.log('4. 发送带思考的问题，观察实时时长显示');
  console.log('5. 刷新页面，确认时长不再变长');
  console.log('6. 查看后端日志，确认以下信息：');
  console.log('   - "Thinking duration calculated: XXXXms"');
  console.log('   - "Thinking duration saved to meta_data: XXXXms"\n');
  process.exit(0);
} else {
  console.log(`${colors.red}✗ 部分检查失败，请确认代码修改是否正确${colors.reset}\n`);
  process.exit(1);
}
