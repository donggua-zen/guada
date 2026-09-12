/**
 * 运行时供应商配置契约
 *
 * 数据层（providers/*.yaml 实例 + bundled 类型卡）→ 运行时
 * （会话 ModelConfig.provider / LLMCompletionParams.providerConfig）的唯一转换点。
 *
 * 两个形态刻意不同，不要再让它们互相透传：
 * - 文件形态（ProviderFileConfig）：配置语义，含 type/models/enabled 等目录信息
 * - 运行形态（RuntimeProviderConfig）：一次调用所需，type 参与行为分发
 *
 * 字段名差异说明：文件形态的 `type`（供应商类型键）在运行形态里仍叫 `type`。
 * 历史字段名 `provider` 已废除——它曾由 DB 行提供，而文件形态没有该字段，
 * 导致文件来源的 providerConfig 在 llm.service 的 "Provider ID is required" 断言处直接抛错。
 */
import type {
  ProviderThinkingConfig,
  ThinkingCompatConfig,
} from '../thinking/thinking-vocabulary';

/** 运行时供应商配置（会话 ModelConfig.provider 与 LLMCompletionParams.providerConfig 的契约） */
export interface RuntimeProviderConfig {
  /** 实例 id（=providers/*.yaml 文件名；模型 id 前缀，也是能力查表键） */
  id: string;
  /** 供应商类型键（行为分发：custom 协议转发判定、适配器兜底与日志） */
  type: string;
  /** wire 协议：openai | openai-response | anthropic | gemini */
  protocol: string;
  apiUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  /**
   * 该模型实际生效的 thinking 档位声明（模型级 > 实例级 > 类型卡，由 store 合并）。
   * 适配器据此解析菜单默认档位——与 compat 必须同源。
   */
  thinking?: ProviderThinkingConfig;
  /**
   * 该模型实际生效的 wire 兼容开关（thinkingFormat/supportsReasoningEffort/...，
   * 由 store 的 resolveThinkingCompat 合并解析；store 视图给的是必填解析值）。
   */
  compat?: ThinkingCompatConfig;
}

/**
 * 转换输入：结构化的供应商来源。
 *
 * 刻意声明为全可选的窄接口而非绑定 ProviderFileConfig——因为本函数要同时接受
 * 文件形态（实例/类型卡）与运行形态（幂等再归一），两者字段是包含关系。
 */
export interface ProviderConfigSource {
  id?: string;
  type?: string;
  protocol?: string;
  apiUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  thinking?: ProviderThinkingConfig;
  compat?: ThinkingCompatConfig;
}

/** 来源形态 → 运行形态（缺字段按运行默认值兜底，不做校验） */
export function toRuntimeProviderConfig(
  provider: ProviderConfigSource | undefined | null,
): RuntimeProviderConfig {
  return {
    id: provider?.id ?? '',
    type: provider?.type ?? '',
    protocol: provider?.protocol || 'openai',
    apiUrl: provider?.apiUrl,
    apiKey: provider?.apiKey,
    headers: provider?.headers,
    thinking: provider?.thinking,
    compat: provider?.compat,
  };
}
