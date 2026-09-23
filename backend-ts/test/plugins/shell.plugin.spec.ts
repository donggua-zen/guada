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
