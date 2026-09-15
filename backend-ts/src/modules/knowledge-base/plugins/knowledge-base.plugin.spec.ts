/**
 * KnowledgeBasePlugin 工具回归测试
 *
 * 回归点：`kb_add_document` 原先要求 `ctx.session.userId`，单账户模型下该字段恒
 * undefined，导致该工具**恒失败**（抛 "Unable to get user identity"）。
 * userId 维度移除后应正常提交文档。
 */
import { KnowledgeBasePlugin } from './knowledge-base.plugin';

/** 捕获 registerToolKit 注册的工具，返回 name → tool 映射 */
async function captureTools(
  plugin: KnowledgeBasePlugin,
): Promise<Record<string, any>> {
  const tools: Record<string, any> = {};
  const api: any = {
    registerNls: jest.fn(),
    registerToolKit: () => ({
      registerTool: (tool: any) => {
        tools[tool.name] = tool;
      },
      registerPrompt: jest.fn(),
    }),
  };
  await plugin.onLoad(api);
  return tools;
}

function createPlugin(kbFileService: any): KnowledgeBasePlugin {
  return new KnowledgeBasePlugin(
    {} as any, // providerStore
    {} as any, // kbRepo
    {} as any, // fileRepo
    {} as any, // chunkRepo
    {} as any, // searchService
    {} as any, // embeddingService
    kbFileService,
  );
}

describe('KnowledgeBasePlugin 文档工具', () => {
  it('kb_add_document 在只有 sessionId 的上下文下提交成功（不因 userId 缺失抛错）', async () => {
    const addTextDocument = jest.fn().mockResolvedValue({
      id: 'file-1',
      displayName: '笔记.md',
      processingStatus: 'pending',
    });
    const tools = await captureTools(createPlugin({ addTextDocument }));

    const raw = await tools['kb_add_document'].execute(
      {
        knowledge_base_id: 'kb-1',
        source_file_path: '/tmp/笔记.md',
        target_path: '笔记.md',
      },
      { session: { sessionId: 'sess-1' } } as any,
    );

    expect(addTextDocument).toHaveBeenCalledWith('kb-1', '/tmp/笔记.md', '笔记.md');
    expect(raw).toContain('file-1');
    expect(raw).toContain('pending');
  });
});
