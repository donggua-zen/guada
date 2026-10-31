/**
 * 示例：代码型供应商包（Ollama 原生协议）
 *
 * - 无第三方依赖，只使用 Node 18+ 内置 fetch/TextDecoder；
 * - 通过 PluginApi.registerProtocolAdapter 贡献 `ollama-native` 协议；
 * - 类型卡（types/*.yaml）由 manifest.provides.providerTypes 声明，loader 自动注入。
 *
 * 该文件同时是「插件适配器契约」的参考实现：
 *   block_start → *_delta → block_end → usage → finish
 *   finish 是终端事件；usage 必须先于 finish。
 */

const DEFAULT_TIMEOUT_MS = 60_000;

function normalizeBase(apiUrl) {
  const raw = String(apiUrl || 'http://localhost:11434').trim();
  const noSlash = raw.replace(/\/+$/, '');
  return noSlash.endsWith('/api') ? noSlash.slice(0, -4) : noSlash;
}

function buildHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    ...(config && config.headers ? config.headers : {}),
  };
  if (config && config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

function safeParseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toOllamaTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters:
        tool.parameters && typeof tool.parameters === 'object'
          ? tool.parameters
          : { type: 'object', properties: {} },
    },
  }));
}

/**
 * 三层 Message[] → Ollama messages[]。
 * 该示例只处理 text / tool-call / tool-result；图片块显式报错（fail-loud）。
 */
function toOllamaMessages(params) {
  const out = [];
  if (params.system) out.push({ role: 'system', content: params.system });

  for (const msg of params.messages || []) {
    const textParts = [];
    const toolCalls = [];
    const toolResults = [];

    for (const block of msg.content || []) {
      if (!block || typeof block !== 'object') continue;
      switch (block.type) {
        case 'text':
          if (block.text) textParts.push(block.text);
          break;
        case 'reasoning':
          // Ollama 的 thinking 只用于输出；历史 reasoning 不再回传
          break;
        case 'tool-call':
          toolCalls.push({
            function: {
              name: block.name,
              arguments: safeParseJson(block.arguments, {}),
            },
          });
          break;
        case 'tool-result':
          toolResults.push({ role: 'tool', content: block.content ?? '' });
          break;
        case 'image':
        case 'file':
          throw new Error(
            'ollama-native: image/file blocks are not supported by this example adapter',
          );
        default:
          break;
      }
    }

    if (msg.role === 'tool') {
      out.push(...toolResults);
      continue;
    }

    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const entry = { role, content: textParts.join('') };
    if (toolCalls.length > 0) entry.tool_calls = toolCalls;
    out.push(entry);
    if (toolResults.length > 0) out.push(...toolResults);
  }

  return out;
}

class OllamaNativeAdapter {
  constructor() {
    this.protocol = 'ollama-native';
    this.displayName = 'Ollama (native)';
    this.capabilities = {
      streaming: true,
      tools: true,
      vision: false,
      reasoning: true,
      embeddings: true,
      modelDiscovery: true,
    };
  }

  async testConnection(config) {
    try {
      const base = normalizeBase(config.apiUrl);
      const res = await fetch(`${base}/api/tags`, {
        headers: buildHeaders(config),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        return {
          success: false,
          message: `Ollama HTTP ${res.status}: ${await res.text()}`,
        };
      }
      const data = await res.json();
      const count = Array.isArray(data.models) ? data.models.length : 0;
      return { success: true, message: `Ollama 连接成功，发现 ${count} 个模型` };
    } catch (err) {
      return {
        success: false,
        message: `连接失败: ${err && err.message ? err.message : String(err)}`,
      };
    }
  }

  async syncRemoteModels(config) {
    const base = normalizeBase(config.apiUrl);
    const res = await fetch(`${base}/api/tags`, {
      headers: buildHeaders(config),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return (data.models || []).map((m) => ({
      id: m.name || m.model,
      owned_by: 'ollama',
      details: m.details,
    }));
  }

  async embeddings(params) {
    const base = normalizeBase(params.providerConfig.apiUrl);
    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: buildHeaders(params.providerConfig),
      body: JSON.stringify({
        model: params.model,
        input: params.input,
        ...(params.dimensions ? { dimensions: params.dimensions } : {}),
      }),
      signal: params.abortSignal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
      embeddings: Array.isArray(data.embeddings) ? data.embeddings : [],
      usage: data.prompt_eval_count
        ? { promptTokens: data.prompt_eval_count, totalTokens: data.prompt_eval_count }
        : undefined,
    };
  }

  async *chatCompletion(params) {
    const config = params.providerConfig || {};
    const base = normalizeBase(config.apiUrl);
    const body = {
      model: params.model,
      messages: toOllamaMessages(params),
      stream: true,
      ...(params.thinkingEffort
        ? { think: params.thinkingEffort !== 'none' }
        : {}),
      ...(toOllamaTools(params.tools) ? { tools: toOllamaTools(params.tools) } : {}),
      options: {
        ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
        ...(typeof params.topP === 'number' ? { top_p: params.topP } : {}),
        ...(typeof params.maxTokens === 'number' ? { num_predict: params.maxTokens } : {}),
      },
    };

    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: params.abortSignal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama HTTP ${res.status}: ${text}`);
    }
    if (!res.body) throw new Error('Ollama response has no body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let blockIndex = 0;
    let textIndex = null;
    let reasoningIndex = null;
    let text = '';
    let reasoning = '';
    let toolCalls = [];
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const closeOpenBlocks = function* () {
      if (reasoningIndex !== null) {
        yield {
          type: 'block_end',
          index: reasoningIndex,
          block: { type: 'reasoning', summary: reasoning },
        };
        reasoningIndex = null;
      }
      if (textIndex !== null) {
        yield {
          type: 'block_end',
          index: textIndex,
          block: { type: 'text', text },
        };
        textIndex = null;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;

          let obj;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }

          const msg = obj.message || {};
          if (obj.error) throw new Error(`Ollama error: ${obj.error}`);

          if (msg.thinking) {
            if (reasoningIndex === null) {
              reasoningIndex = blockIndex++;
              yield { type: 'block_start', index: reasoningIndex, blockType: 'reasoning' };
            }
            reasoning += msg.thinking;
            yield { type: 'reasoning_delta', index: reasoningIndex, text: msg.thinking };
          }

          if (msg.content) {
            if (textIndex === null) {
              textIndex = blockIndex++;
              yield { type: 'block_start', index: textIndex, blockType: 'text' };
            }
            text += msg.content;
            yield { type: 'text_delta', index: textIndex, text: msg.content };
          }

          if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            toolCalls = toolCalls.concat(msg.tool_calls);
          }

          if (typeof obj.prompt_eval_count === 'number') {
            usage.promptTokens = obj.prompt_eval_count;
          }
          if (typeof obj.eval_count === 'number') {
            usage.completionTokens = obj.eval_count;
          }
          usage.totalTokens = usage.promptTokens + usage.completionTokens;
        }
      }

      yield* closeOpenBlocks();

      for (let i = 0; i < toolCalls.length; i += 1) {
        const call = toolCalls[i] || {};
        const fn = call.function || {};
        const args =
          typeof fn.arguments === 'string'
            ? fn.arguments
            : JSON.stringify(fn.arguments || {});
        const id = call.id || `ollama_call_${Date.now()}_${i}`;
        const index = blockIndex++;
        yield { type: 'block_start', index, blockType: 'tool-call' };
        yield {
          type: 'tool_call_delta',
          index,
          toolCallId: id,
          name: fn.name,
          argumentsDelta: args,
        };
        yield {
          type: 'block_end',
          index,
          block: { type: 'tool-call', toolCallId: id, name: fn.name, arguments: args },
        };
      }

      yield { type: 'usage', usage };
      yield { type: 'finish', finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop' };
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }
}

class OllamaProviderPlugin {
  constructor() {
    this.manifest = {
      id: 'provider-ollama',
      name: 'Ollama 供应商',
      version: '1.0.0',
      description: '通过 Ollama 原生 /api/chat 协议接入本地模型（代码型供应商包示例）',
      category: 'user',
      providerApi: 1,
    };
  }

  async onLoad(api) {
    api.registerProtocolAdapter({
      protocol: 'ollama-native',
      adapter: new OllamaNativeAdapter(),
      displayName: 'Ollama (native)',
    });
  }
}

module.exports = OllamaProviderPlugin;
