/**
 * 日志系统测试脚本
 * 
 * 用于验证 Winston 日志配置是否正常工作
 */
import { Logger } from '@nestjs/common';
import { createWinstonConfig } from '../common/logger/winston.config';
import { WinstonModule } from 'nest-winston';
import * as fs from 'fs';
import * as path from 'path';

async function testLogger() {
  console.log('开始测试日志系统...\n');

  // 创建测试日志目录
  const testLogsDir = path.join(__dirname, '..', '..', 'test-logs');
  if (!fs.existsSync(testLogsDir)) {
    fs.mkdirSync(testLogsDir, { recursive: true });
  }

  // 创建 logger 实例
  const logger = WinstonModule.createLogger(createWinstonConfig(testLogsDir));

  // 测试不同级别的日志
  logger.log('这是一条普通日志消息', 'TestContext');
  logger.debug('这是一条调试日志', 'TestContext');
  logger.verbose('这是一条详细日志', 'TestContext');
  logger.warn('这是一条警告日志', 'TestContext');
  logger.error('这是一条错误日志', 'TestContext');

  // 测试带堆栈的错误
  try {
    throw new Error('测试错误');
  } catch (error) {
    logger.error('捕获到异常:', error instanceof Error ? error.stack : String(error), 'TestContext');
  }

  console.log('\n日志已写入，请检查以下目录:');
  console.log(`   ${testLogsDir}\n`);

  // 等待 2 秒让文件写入完成
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 检查日志文件是否生成
  const files = fs.readdirSync(testLogsDir);
  if (files.length > 0) {
    console.log('生成的日志文件:');
    files.forEach(file => {
      const stats = fs.statSync(path.join(testLogsDir, file));
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`   - ${file} (${sizeKB} KB)`);
    });
    console.log('\n日志系统工作正常！');
  } else {
    console.log('未检测到日志文件生成');
  }

  // 清理测试文件（可选）
  console.log('\n提示: 测试日志位于 test-logs 目录，可以手动删除');
}

testLogger().catch(console.error);
