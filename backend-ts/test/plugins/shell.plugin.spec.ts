import { Test, TestingModule } from '@nestjs/testing';
import { ShellPlugin } from '../../src/modules/shell/shell.plugin';
import { ProcessManagerService } from '../../src/modules/shell/process-manager.service';
import { AskService } from '../../src/common/services/ask.service';
import { InteractionWaitService } from '../../src/common/services/interaction-wait.service';

describe('ShellPlugin', () => {
  let plugin: ShellPlugin;
  let mockProcessManager: Record<string, any>;

  beforeEach(async () => {
    mockProcessManager = {
      kill: jest.fn(),
      writeToStdin: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShellPlugin,
        { provide: ProcessManagerService, useValue: mockProcessManager },
        {
          provide: AskService,
          useValue: new AskService(new InteractionWaitService()),
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
});
