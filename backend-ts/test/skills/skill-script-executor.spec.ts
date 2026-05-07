import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { SkillScriptExecutor } from '../../src/modules/skills/execution/skill-script-executor.service';
import { ScriptExecutionRequest } from '../../src/modules/skills/interfaces/index';

describe('SkillScriptExecutor', () => {
  let executor: SkillScriptExecutor;
  const testSkillsDir = path.join(__dirname, '../fixtures/skills');

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [SkillScriptExecutor],
    }).compile();

    executor = module.get<SkillScriptExecutor>(SkillScriptExecutor);
  });

  describe('execute', () => {
    it('应该成功执行 Python 脚本', async () => {
      const request: ScriptExecutionRequest = {
        skillId: 'test-skill-beta',
        scriptPath: path.join(testSkillsDir, 'test-skill-beta', 'scripts', 'hello.py'),
        timeoutMs: 5000,
      };

      const result = await executor.execute(request);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from test skill beta!');
      expect(result.stderr).toBe('');
      expect(result.timedOut).toBe(false);
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('应该在脚本不存在时失败', async () => {
      const request: ScriptExecutionRequest = {
        skillId: 'test-skill',
        scriptPath: '/nonexistent/script.py',
        timeoutMs: 5000,
      };

      await expect(executor.execute(request)).rejects.toThrow();
    });

    it('应该支持传递参数', async () => {
      const request: ScriptExecutionRequest = {
        skillId: 'test-skill-beta',
        scriptPath: path.join(testSkillsDir, 'test-skill-beta', 'scripts', 'hello.py'),
        args: ['--test', 'value'],
        timeoutMs: 5000,
      };

      const result = await executor.execute(request);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--test');
      expect(result.stdout).toContain('value');
    });

    it('应该在超时时终止执行', async () => {
      // 创建一个会睡眠的测试脚本
      const sleepScript = path.join(testSkillsDir, 'test-skill-beta', 'scripts', 'sleep.py');
      const fs = require('fs');
      fs.writeFileSync(sleepScript, `
import time
time.sleep(10)
print("Should not reach here")
`);

      const request: ScriptExecutionRequest = {
        skillId: 'test-skill-beta',
        scriptPath: sleepScript,
        timeoutMs: 500, // 500ms 超时
      };

      const result = await executor.execute(request);

      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);

      // 清理测试文件
      fs.unlinkSync(sleepScript);
    }, 10000); // 增加测试超时时间

    it('应该限制输出大小', async () => {
      // 创建一个输出大量数据的脚本
      const largeOutputScript = path.join(testSkillsDir, 'test-skill-beta', 'scripts', 'large_output.py');
      const fs = require('fs');
      fs.writeFileSync(largeOutputScript, `
print("x" * 2000000)  # 输出 2MB 数据
`);

      const request: ScriptExecutionRequest = {
        skillId: 'test-skill-beta',
        scriptPath: largeOutputScript,
        maxOutputBytes: 1024 * 100, // 100KB 限制
        timeoutMs: 5000,
      };

      const result = await executor.execute(request);

      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBeLessThanOrEqual(1024 * 100);

      // 清理测试文件
      fs.unlinkSync(largeOutputScript);
    }, 10000);
  });
});
