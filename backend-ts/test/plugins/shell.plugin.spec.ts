import { Test, TestingModule } from '@nestjs/testing';
import { ShellPlugin } from '../../src/modules/shell/shell.plugin';
import { ProcessManagerService } from '../../src/modules/shell/process-manager.service';
import { AskService } from '../../src/common/services/ask.service';
import { InteractionWaitService } from '../../src/common/services/interaction-wait.service';
import { WorkspaceToolRouter } from '../../src/modules/remote-workspace/workspace-router';

describe('ShellPlugin', () => {
  let plugin: ShellPlugin;
  let mockProcessManager: Record<string, any>;

  beforeEach(async () => {
    mockProcessManager = {
      kill: jest.fn(),
      writeToStdin: jest.fn(),
      drainCompleted: jest.fn(async () => []),
      listBySession: jest.fn(() => []),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShellPlugin,
        { provide: ProcessManagerService, useValue: mockProcessManager },
        {
          provide: AskService,
          useValue: new AskService(new InteractionWaitService()),
        },
        {
          provide: WorkspaceToolRouter,
          useValue: {
            resolveRemoteTarget: () => Promise.resolve(null),
            drainRemoteProcesses: () => Promise.resolve([]),
            getTrackedRemoteProcesses: () => [],
            registerRemoteProcess: () => {},
            unregisterRemoteProcess: () => {},
          },
        },
      ],
    }).compile();

    plugin = module.get<ShellPlugin>(ShellPlugin);
  });

  it('should be defined', () => {
    expect(plugin).toBeDefined();
  });

  it('should have correct manifest', () => {
    expect(plugin.manifest.id).toBe('shell');
    // manifest 使用 NLS key，由 NlsService 按 locale 解析
    expect(plugin.manifest.name).toBe('%shell.name%');
    expect(plugin.manifest.category).toBe('core');
  });

  it('should define onLoad method', () => {
    expect(plugin.onLoad).toBeDefined();
  });

  it('should define handleStreamFinished method', () => {
    expect((plugin as any).handleStreamFinished).toBeDefined();
  });

  describe('run_command 壳提示（按检测到的 shell 分支）', () => {
    // 描述文本在 onLoad 时按平台能力生成：显式打开策略层，保证任意平台断言一致
    const originalFlag = process.env.GUADA_COMMAND_POLICY;
    beforeAll(() => {
      process.env.GUADA_COMMAND_POLICY = '1';
    });
    afterAll(() => {
      if (originalFlag === undefined) delete process.env.GUADA_COMMAND_POLICY;
      else process.env.GUADA_COMMAND_POLICY = originalFlag;
    });

    /** 以指定 shell 检测结果加载插件，返回注册进工具箱的 run_command 工具 */
    async function loadRunCommandTool(shell: { kind: string; info: string }) {
      const registeredTools: any[] = [];
      const mockShellManager = {
        kill: jest.fn(),
        writeToStdin: jest.fn(),
        drainCompleted: jest.fn(async () => []),
        listBySession: jest.fn(() => []),
        getShellKind: () => shell.kind,
        getShellInfo: () => shell.info,
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ShellPlugin,
          { provide: ProcessManagerService, useValue: mockShellManager },
          {
            provide: AskService,
            useValue: new AskService(new InteractionWaitService()),
          },
          {
            provide: WorkspaceToolRouter,
            useValue: {
              resolveRemoteTarget: () => Promise.resolve(null),
              drainRemoteProcesses: () => Promise.resolve([]),
              getTrackedRemoteProcesses: () => [],
              registerRemoteProcess: () => {},
              unregisterRemoteProcess: () => {},
            },
          },
        ],
      }).compile();

      const plugin = module.get<ShellPlugin>(ShellPlugin);
      const api = {
        registerNls: jest.fn(),
        registerToolKit: jest.fn(() => ({
          registerTool: jest.fn((tool: any) => registeredTools.push(tool)),
          registerPrompt: jest.fn(),
        })),
      };
      await plugin.onLoad(api as any);
      return registeredTools.find((tool) => tool.name === 'run_command');
    }

    it('Git Bash：给 POSIX 语法提示 + 命令审批说明（本平台无 OS 沙盒）', async () => {
      const tool = await loadRunCommandTool({
        kind: 'gitbash',
        info: 'Git Bash (C:\\Program Files\\Git\\bin\\bash.exe)',
      });

      expect(tool.description).toContain('Git Bash (C:\\Program Files\\Git\\bin\\bash.exe)');
      expect(tool.description).toContain('POSIX/bash syntax');
      expect(tool.description).toContain('Command approval (no OS sandbox on this platform)');
      // 不能给 PowerShell 的旧提示，否则模型会按 PS 语法写命令
      expect(tool.description).not.toContain('Use PowerShell syntax');
      // Windows 默认没有 OS 沙盒，不该再宣称"沙盒档位换壳"
      expect(tool.description).not.toContain('Sandboxed modes use a different shell');
      // 也不再教模型用 sandbox_permissions 提权
      expect(tool.description).not.toContain('Sandbox escalation');
      expect(tool.inputSchema.shape.command.description).toContain('Git Bash');
      expect(tool.inputSchema.shape.encoding.description).toContain('UTF-8');
    });

    it('PowerShell：保留 PS 语法提示，不含 Git Bash 提示与沙盒换壳说明', async () => {
      const tool = await loadRunCommandTool({
        kind: 'powershell',
        info: 'Windows PowerShell (C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe)',
      });

      expect(tool.description).toContain('Use PowerShell syntax');
      expect(tool.description).not.toContain('POSIX/bash syntax');
      expect(tool.description).not.toContain('Sandboxed modes use a different shell');
      expect(tool.inputSchema.shape.command.description).toContain('PowerShell command');
    });

    it('cmd.exe：保留多行命令警告', async () => {
      const tool = await loadRunCommandTool({ kind: 'cmd', info: 'cmd.exe' });

      expect(tool.description).toContain('cmd.exe only executes the first line');
      expect(tool.description).not.toContain('POSIX/bash syntax');
    });
  });

  describe('命令策略门（Windows 去沙盒）：白名单 / 审批 / 拒绝 / 无人值守', () => {
    const GIT_BASH_INFO = 'Git Bash (C:\\Program Files\\Git\\bin\\bash.exe)';

    async function setupPolicy(options: {
      mode?: string;
      plan?: boolean;
      answerSurface?: boolean;
      shellKind?: string;
      approval?: 'once' | 'session' | 'deny';
    }) {
      const tools: any[] = [];
      const ask = {
        requestApproval: jest.fn(),
        requestCommandApproval: jest.fn(
          async (
            _session: unknown,
            _params: { command: string; reason?: string; toolCallId?: string },
          ): Promise<'once' | 'session'> => {
            if (options.approval === 'deny') {
              throw new Error('AskDeniedError: 用户拒绝执行该命令');
            }
            return options.approval ?? 'once';
          },
        ),
      };
      const pm = {
        kill: jest.fn(),
        writeToStdin: jest.fn(),
        drainCompleted: jest.fn(async () => []),
        listBySession: jest.fn(() => []),
        getShellKind: () => options.shellKind ?? 'gitbash',
        getShellInfo: () => GIT_BASH_INFO,
        isSandboxAvailable: jest.fn(async () => false),
        execute: jest.fn(async () => ({
          kind: 'completed',
          output: 'ok',
          exitCode: 0,
          uptimeMs: 3,
          truncated: false,
          processStatus: 'exited',
        })),
      };
      const session = {
        sessionId: 'sess-policy',
        sessionType: 'web',
        workspacePath: 'C:\\ws',
        getSandboxMode: () => options.mode ?? 'workspace-write',
        getPlanEnabled: () => options.plan === true,
        hasAnswerSurface: () => options.answerSurface !== false,
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ShellPlugin,
          { provide: ProcessManagerService, useValue: pm },
          { provide: AskService, useValue: ask },
          {
            provide: WorkspaceToolRouter,
            useValue: {
              resolveRemoteTarget: () => Promise.resolve(null),
              drainRemoteProcesses: () => Promise.resolve([]),
              getTrackedRemoteProcesses: () => [],
              registerRemoteProcess: () => {},
              unregisterRemoteProcess: () => {},
            },
          },
        ],
      }).compile();

      const plugin = module.get<ShellPlugin>(ShellPlugin);
      const api = {
        registerNls: jest.fn(),
        registerToolKit: jest.fn(() => ({
          registerTool: jest.fn((tool: any) => tools.push(tool)),
          registerPrompt: jest.fn(),
        })),
      };
      await plugin.onLoad(api as any);

      const tool = tools.find((t) => t.name === 'run_command');
      const ctx = { session, toolCallId: 'call-1' } as any;
      return { tool, ctx, ask, pm, session };
    }

    const originalFlag = process.env.GUADA_COMMAND_POLICY;
    beforeAll(() => {
      // 策略层在 Windows 上默认生效；这里显式打开，保证 CI（Linux）行为一致
      process.env.GUADA_COMMAND_POLICY = '1';
    });
    afterAll(() => {
      if (originalFlag === undefined) delete process.env.GUADA_COMMAND_POLICY;
      else process.env.GUADA_COMMAND_POLICY = originalFlag;
    });
    beforeEach(async () => {
      const { commandApprovalMemory } = await import(
        '../../src/common/services/command-policy'
      );
      commandApprovalMemory.clear();
    });

    it('白名单命令直接执行，不打扰用户', async () => {
      const { tool, ctx, ask, pm } = await setupPolicy({});

      const result = await tool.execute({ command: 'git status' }, ctx, undefined);

      expect(pm.execute).toHaveBeenCalledTimes(1);
      expect(ask.requestCommandApproval).not.toHaveBeenCalled();
      expect(String(result.content)).toContain('[exit code: 0');
    });

    it('非白名单命令 → 审批通过（本次允许）后执行', async () => {
      const { tool, ctx, ask, pm } = await setupPolicy({ approval: 'once' });

      await tool.execute({ command: 'npm install' }, ctx, undefined);

      expect(ask.requestCommandApproval).toHaveBeenCalledTimes(1);
      const request = ask.requestCommandApproval.mock.calls[0][1];
      expect(request.command).toBe('npm install');
      expect(request.toolCallId).toBe('call-1');
      expect(pm.execute).toHaveBeenCalledTimes(1);
    });

    it('用户拒绝 → 不执行命令', async () => {
      const { tool, ctx, pm } = await setupPolicy({ approval: 'deny' });

      await expect(tool.execute({ command: 'npm install' }, ctx, undefined)).rejects.toThrow(
        /用户拒绝/,
      );
      expect(pm.execute).not.toHaveBeenCalled();
    });

    it('read-only 档：非白名单命令直接拒绝，不弹窗', async () => {
      const { tool, ctx, ask, pm } = await setupPolicy({ mode: 'read-only' });

      await expect(tool.execute({ command: 'npm install' }, ctx, undefined)).rejects.toThrow(
        /Read-only mode denied this command/,
      );
      expect(ask.requestCommandApproval).not.toHaveBeenCalled();
      expect(pm.execute).not.toHaveBeenCalled();
    });

    it('计划模式（正交开关）同样按只读判定', async () => {
      const { tool, ctx, pm } = await setupPolicy({ mode: 'workspace-write', plan: true });

      await expect(tool.execute({ command: 'rm -rf build' }, ctx, undefined)).rejects.toThrow(
        /Read-only mode denied this command/,
      );
      expect(pm.execute).not.toHaveBeenCalled();
    });

    it('无人可应答审批（子代理/无订阅者）→ 直接拒绝，不挂起', async () => {
      const { tool, ctx, ask, pm } = await setupPolicy({ answerSurface: false });

      await expect(tool.execute({ command: 'npm install' }, ctx, undefined)).rejects.toThrow(
        /no approval prompt can be shown right now/,
      );
      expect(ask.requestCommandApproval).not.toHaveBeenCalled();
      expect(pm.execute).not.toHaveBeenCalled();
    });

    it('danger-full-access 档不做判定', async () => {
      const { tool, ctx, ask, pm } = await setupPolicy({ mode: 'danger-full-access' });

      await tool.execute({ command: 'rm -rf build && npm run build' }, ctx, undefined);

      expect(ask.requestCommandApproval).not.toHaveBeenCalled();
      expect(pm.execute).toHaveBeenCalledTimes(1);
    });

    it('审批卡给用户中文说明，诊断细节（英文）只进模型可见文案', async () => {
      const once = await setupPolicy({ approval: 'once' });
      await once.tool.execute({ command: 'npm install' }, once.ctx, undefined);
      const unknownParams = (once.ask.requestCommandApproval.mock.calls[0] as any[])[1];
      expect(unknownParams.reason).toContain('不在只读白名单');
      expect(unknownParams.reason).not.toMatch(/[A-Za-z]/);

      const write = await setupPolicy({ approval: 'once' });
      await write.tool.execute({ command: 'echo hi > out.txt' }, write.ctx, undefined);
      const writeParams = (write.ask.requestCommandApproval.mock.calls[0] as any[])[1];
      expect(writeParams.reason).toContain('写 / 删除操作');
      expect(writeParams.reason).not.toMatch(/[A-Za-z]/);
    });

    it('「本会话内始终允许」对同一条命令只问一次', async () => {
      const { tool, ctx, ask } = await setupPolicy({ approval: 'session' });

      await tool.execute({ command: 'npm run build' }, ctx, undefined);
      await tool.execute({ command: 'npm run build' }, ctx, undefined);
      // 语义不同的命令仍会问
      await tool.execute({ command: 'npm run build --prod' }, ctx, undefined);

      expect(ask.requestCommandApproval).toHaveBeenCalledTimes(2);
    });

    it('沙盒提权参数在策略平台上报"不可用"（模型不该再走 escalation）', async () => {
      const { tool, ctx, pm } = await setupPolicy({});

      await expect(
        tool.execute(
          {
            command: 'npm install',
            sandbox_permissions: 'danger-full-access',
            justification: '需要安装依赖',
          },
          ctx,
          undefined,
        ),
      ).rejects.toThrow(/sandbox_permissions is unavailable on this platform/);
      expect(pm.execute).not.toHaveBeenCalled();
    });
  });

  describe('handleTurnStopping（回合结束续跑钩子）', () => {
    const sessionContext = {
      sessionId: 'sess-hook',
      sessionType: 'main',
    } as any;

    it('有已完成输出 → 返回 continue 并携带输出', async () => {
      (mockProcessManager.drainCompleted as jest.Mock).mockResolvedValue([
        {
          processId: 'p1',
          status: 'completed',
          exitCode: 0,
          output: 'hello-drain',
          waitMs: 0,
          uptimeMs: 100,
          truncated: false,
        },
      ]);

      const decision = await plugin.handleTurnStopping({ sessionContext });
      expect(decision).toBeDefined();
      expect(decision!.kind).toBe('continue');
      expect(decision!.messages[0]).toContain('hello-drain');
      expect(decision!.messages[0]).toContain('p1');
    });

    it('已完成但无输出 → 仍返回 continue（静默完成事件不丢失）', async () => {
      (mockProcessManager.drainCompleted as jest.Mock).mockResolvedValue([
        {
          processId: 'p2',
          status: 'completed',
          exitCode: 0,
          output: '',
          waitMs: 0,
          uptimeMs: 100,
          truncated: false,
        },
      ]);

      const decision = await plugin.handleTurnStopping({ sessionContext });
      expect(decision).toBeDefined();
      expect(decision!.kind).toBe('continue');
      expect(decision!.messages[0]).toContain('(no output)');
      expect(decision!.messages[0]).toContain('p2');
    });

    it('无已完成进程且无运行中进程 → undefined（不续跑，回合正常关闭）', async () => {
      (mockProcessManager.drainCompleted as jest.Mock).mockResolvedValue([]);

      const decision = await plugin.handleTurnStopping({ sessionContext });
      expect(decision).toBeUndefined();
    });
  });
});
