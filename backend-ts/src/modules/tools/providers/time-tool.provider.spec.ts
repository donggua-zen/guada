import { Test, TestingModule } from '@nestjs/testing';
import { TimeToolProvider } from './time-tool.provider';

describe('TimeToolProvider', () => {
    let provider: TimeToolProvider;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [TimeToolProvider],
        }).compile();

        provider = module.get<TimeToolProvider>(TimeToolProvider);
    });

    it('should be defined', () => {
        expect(provider).toBeDefined();
    });

    it('should return empty array for getToolsNamespaced', async () => {
        const tools = await provider.getToolsNamespaced(true, {});
        expect(tools).toEqual([]);
    });

    it('should return error response when executeWithNamespace is called', async () => {
        const request = {
            id: 'test-id',
            name: 'time__test',
            arguments: {},
        };

        const response = await provider.executeWithNamespace(request, {});
        expect(response.isError).toBe(true);
        expect(response.content).toContain('时间工具仅用于提示词注入');
    });

    it('should return current time in prompt', async () => {
        const prompt = await provider.getPrompt({});
        expect(prompt).toContain('【当前时间信息】');
        expect(prompt).toContain('当前时间是：');
        expect(prompt).toContain('请注意：在与用户对话时，如果需要提及时间相关信息，请使用上述提供的准确时间。');
    });
});