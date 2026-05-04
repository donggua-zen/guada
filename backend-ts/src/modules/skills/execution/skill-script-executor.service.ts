import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import { ScriptExecutionRequest, ScriptExecutionResult } from '../interfaces/index';
import { WorkspaceService } from '../../../common/services/workspace.service';

@Injectable()
export class SkillScriptExecutor {
  private readonly logger = new Logger(SkillScriptExecutor.name);

  constructor(private workspaceService: WorkspaceService) {}

  /**
   * 执行脚本
   */
  async execute(request: ScriptExecutionRequest, context?: Record<string, any>): Promise<ScriptExecutionResult> {
    const startTime = Date.now();
    const timeout = request.timeoutMs || 30000;
    const maxOutput = request.maxOutputBytes || 1024 * 1024; // 1MB

    return new Promise((resolve, reject) => {
      const scriptPath = path.join(request.scriptPath);
      
      // 检测脚本类型并选择解释器
      const ext = path.extname(scriptPath).toLowerCase();
      let command: string;
      let args: string[];

      switch (ext) {
        case '.py':
          command = 'python';
          args = [scriptPath, ...(request.args || [])];
          break;
        case '.js':
          command = 'node';
          args = [scriptPath, ...(request.args || [])];
          break;
        case '.sh':
          command = 'bash';
          args = [scriptPath, ...(request.args || [])];
          break;
        default:
          reject(new Error(`Unsupported script type: ${ext}`));
          return;
      }

      // 如果上下文中包含 sessionId，则设置当前工作目录为会话专属目录
      let cwd: string | undefined;
      if (context?.sessionId) {
        try {
          cwd = this.workspaceService.getWorkspaceDir(context.sessionId);
        } catch (error: any) {
          this.logger.warn(`Failed to set CWD for session ${context.sessionId}: ${error.message}`);
        }
      }

      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...request.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > maxOutput) {
          stdout = stdout.substring(0, maxOutput);
          child.kill();
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > maxOutput) {
          stderr = stderr.substring(0, maxOutput);
          child.kill();
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
          timedOut,
          truncated: stdout.length >= maxOutput || stderr.length >= maxOutput,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}
