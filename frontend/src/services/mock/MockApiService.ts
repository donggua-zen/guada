/**
 * Mock API 服务
 * 提供开发环境下的 Mock 模式支持
 */

import type { StreamEvent } from "@/types/service";

/**
 * 创建 Mock 模式的方法集合（延迟加载配置）
 */
export function createMockMethods() {
  // 缓存配置，避免重复加载
  let cachedConfig: any = null;
  let configPromise: Promise<any> | null = null;

  // 异步加载配置的函数
  async function loadMockConfig(): Promise<any> {
    if (cachedConfig) return cachedConfig;
    if (configPromise) return configPromise;

    configPromise = (async () => {
      let defaultConfig: any = {};
      const scenarioName =
        localStorage.getItem("VITE_MOCK_SCENARIO") ||
        import.meta.env.VITE_MOCK_SCENARIO;

      if (scenarioName) {
        try {
          const { getScenarioConfig } = await import("../mockStreamService");
          defaultConfig = getScenarioConfig(scenarioName as any);
        } catch (e) {
          console.warn("[Mock] 场景配置加载失败:", e);
        }
      }

      // 支持自定义配置覆盖
      const customConfigStr =
        localStorage.getItem("VITE_MOCK_CUSTOM_CONFIG") ||
        import.meta.env.VITE_MOCK_CUSTOM_CONFIG;
      if (customConfigStr) {
        try {
          defaultConfig = { ...defaultConfig, ...JSON.parse(customConfigStr) };
        } catch (e) {
          console.warn("[Mock] 自定义配置解析失败:", e);
        }
      }

      cachedConfig = defaultConfig;
      console.log("[Mock] 配置已加载", defaultConfig);
      return defaultConfig;
    })();

    return configPromise;
  }

  // Mock 的 chat 方法
  const mockChat = async function* (
    params: {
      sessionId: string;
      regenerationMode?: string | null;
      assistantMessageId?: string | null;
      resumeData?: any;
      userMessage?: {
        id?: string;
        content?: string;
        files?: string[];
        replaceMessageId?: string;
        knowledgeBaseIds?: string[];
      };
    }
  ): AsyncGenerator<any, void, unknown> {
    // 首次调用时加载配置
    const config = await loadMockConfig();

    const {
      sessionId,
      regenerationMode,
      assistantMessageId,
      userMessage,
    } = params;

    console.log(`[Mock] 拦截 chat 请求:`, {
      sessionId,
      regenerationMode,
      assistantMessageId,
      content: userMessage?.content ? userMessage.content.substring(0, 50) + (userMessage.content.length > 50 ? "..." : "") : undefined,
    });

    // enableReasoning 已废弃，移除相关逻辑

    // 动态导入 Mock 服务
    const { mockChatStream } = await import("../mockStreamService");

    try {
      yield* mockChatStream(
        sessionId,
        config,
        assistantMessageId,
        regenerationMode,
      );
    } catch (error) {
      console.error("[Mock] 模拟错误:", error);
      throw error;
    }
  };

  // Mock 的 createMessage 方法
  const mockCreateMessage = async (
    sessionId: string,
    content: string,
    files: any[] = [],
    replaceMessageId: string | null = null,
    knowledgeBaseIds?: string[],
  ): Promise<any> => {
    console.log(`[Mock] 拦截 createMessage 请求:`, {
      sessionId,
      content: content.substring(0, 50) + (content.length > 50 ? "..." : ""),
      filesCount: files.length,
      replaceMessageId,
      knowledgeBaseIds,
    });

    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 生成模拟的消息 ID
    const mockMessageId = `mock_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    // 返回模拟的用户消息
    return {
      id: mockMessageId,
      sessionId,
      role: "user",
      content,
      files: files || [],
      parentId: replaceMessageId,
      currentTurnsId: null,
      state: {
        isStreaming: false,
        isThinking: false,
      },
      createdAt: now,
      updatedAt: now,
      contents: [
        {
          content: content,
          additionalKwargs: {},
        },
      ],
    };
  };

  return {
    chat: mockChat,
    createMessage: mockCreateMessage,
  };
}

/**
 * 检查是否应该启用 Mock
 */
export function shouldEnableMock(): boolean {
  // 生产环境强制禁用
  if (import.meta.env.PROD) {
    return false;
  }

  // 优先从 localStorage 读取
  const localStorageEnabled = localStorage.getItem("VITE_ENABLE_MOCK");
  if (localStorageEnabled !== null) {
    return localStorageEnabled === "true";
  }

  // 降级到环境变量
  return import.meta.env.VITE_ENABLE_MOCK === "true";
}
