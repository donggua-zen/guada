/**
 * 生成 bundled-providers/*.yaml 供应商类型目录卡
 *
 * bundled 文件 = 随应用版本分发的「类型目录」数据（对齐 DSH pi-ai catalog）：
 * metadata + thinking 默认 + 全量模型条目卡（含逐模型 thinkingEfforts）。
 * 用户实例文件（providers/*.yaml）不复制目录内容，运行时按 modelName
 * 条目级继承 + 覆盖；目录随应用升级自动流到未覆盖的实例。
 *
 * 运行：node scripts/run-generate-bundled.cjs（ts-node 包装）
 * 注意：数据成为唯一权威源后，本脚本与类型类可一并退役。
 *
 * thinkingStyle 分配依据：原各类型专属 adapter 的 buildRequestParam 覆写行为
 * （行为零回归，见 docs 内 thinking 收敛设计）：
 *   thinking-toggle   → deepseek, volcengine（火山双协议共用，Responses 侧自动升级）
 *   enable-thinking   → aliyun-bailian, moonshot, baidu-qianfan, siliconflow
 *   reasoning-split   → minimax
 *   （默认 reasoning-effort → openai, openai-response, azure-openai, zhipu,
 *     custom, xqapi, google, anthropic, groq）
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { IModelProvider } from '../src/modules/llm-core/types/provider.types';

/**
 * 逐模型 thinking 档位规则（从原类型类 getModelThinkingEfforts 的 if 规则
 * 数据化而来，与 git HEAD 行为一一对应；embedding 由调用方统一排除）
 */
const THINKING_RULES: Record<
  string,
  (lowerName: string, defaults: string[]) => string[]
> = {
  // o 系/GPT-5 支持 reasoning_effort；gpt-4o 不支持；其他不支持
  openai: (n) =>
    n.includes('gpt-4o')
      ? []
      : n.startsWith('o') || n.startsWith('gpt-5')
        ? ['low', 'medium', 'high']
        : [],
  'azure-openai': (n) =>
    n.includes('gpt-4o')
      ? []
      : n.startsWith('o') || n.startsWith('gpt-5')
        ? ['low', 'medium', 'high']
        : [],
  'openai-response': (_n, d) => d, // Responses API 全部模型支持
  anthropic: (_n, d) => d, // adaptive，无 none 档
  deepseek: (_n, d) => d, // ['none','high','max']
  moonshot: (_n, d) => d, // ['none','on']
  zhipu: (_n, d) => d, // ['none','on']
  'baidu-qianfan': (_n, d) => d, // ['none','on']
  'aliyun-bailian': (_n, d) => d, // ['none','low','medium','high','xhigh']
  siliconflow: (_n, d) => d, // 全部非 embedding 用默认
  volcengine: (n) =>
    n.startsWith('doubao-seed')
      ? ['none', 'minimal', 'low', 'medium', 'high']
      : ['none', 'on'],
  // gemini-3.x 支持 thinkingLevel（pro 无 minimal）；2.5 及以下不支持
  google: (n) =>
    n.includes('gemini-3.')
      ? n.includes('-pro')
        ? ['low', 'medium', 'high']
        : ['minimal', 'low', 'medium', 'high']
      : [],
  'xqapi': (n) => (n.startsWith('gpt-5') ? ['none', 'low', 'medium', 'high'] : []),
  minimax: () => [],
  groq: () => [],
  mock: () => [],
};

interface GeneratedFile {
  fileName: string;
  headerComment: string[];
  data: Record<string, unknown>;
}

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const outDir = path.join(root, 'bundled-providers');
  fs.mkdirSync(outDir, { recursive: true });

  // [类型 id, 模块路径, thinkingStyle 或 undefined（协议默认）]
  const catalog: Array<[string, string, string | undefined]> = [
    ['openai', 'openai/openai.provider', undefined],
    ['openai-response', 'openai-response/openai-response.provider', undefined],
    ['anthropic', 'anthropic/anthropic.provider', undefined],
    ['google', 'google/google.provider', undefined],
    ['deepseek', 'deepseek/deepseek.provider', 'thinking-toggle'],
    ['azure-openai', 'azure-openai/azure-openai.provider', undefined],
    ['moonshot', 'moonshot/moonshot.provider', 'enable-thinking'],
    ['zhipu', 'zhipu/zhipu.provider', undefined],
    ['aliyun-bailian', 'aliyun-bailian/aliyun-bailian.provider', 'enable-thinking'],
    ['baidu-qianfan', 'baidu-qianfan/baidu-qianfan.provider', 'enable-thinking'],
    ['volcengine', 'volcengine/volcengine.provider', 'thinking-toggle'],
    ['minimax', 'minimax/minimax.provider', 'reasoning-split'],
    ['groq', 'groq/groq.provider', undefined],
    ['siliconflow', 'siliconflow/siliconflow.provider', 'enable-thinking'],
    ['xqapi', 'xqapi/xqapi.provider', undefined],
    ['custom', 'custom/custom.provider', undefined],
    ['mock', 'mock/mock.provider', undefined],
  ];

  let created = 0;
  let skipped = 0;

  for (const [typeId, modulePath, style] of catalog) {
    const outFile = path.join(outDir, `${typeId}.yaml`);
    if (fs.existsSync(outFile)) {
      skipped += 1;
      continue;
    }

    const mod = require(path.join(root, 'src/modules/llm-core/providers', modulePath));
    const Cls = Object.values(mod).find(
      (v: any) => typeof v === 'function' && typeof v.prototype?.getMetadata === 'function',
    ) as any;
    if (!Cls) {
      throw new Error(`No provider class found in ${modulePath}`);
    }
    const provider: IModelProvider = new Cls();
    const metadata = provider.getMetadata();

    const thinking = (provider as any).thinking as
      | { style?: string; defaultEfforts?: string[] }
      | undefined;
    const defaultEfforts = thinking?.defaultEfforts;

    const models = (provider.getModels() || []).map((m: any) => {
      const entry: Record<string, unknown> = {
        modelName: m.modelName,
        modelType: m.modeType || m.modelType || 'text',
      };
      const lower = m.modelName.toLowerCase();
      const isEmbed =
        (m.modeType || m.modelType) === 'embedding' ||
        lower.includes('embedding') ||
        lower.includes('embed');
      const efforts: string[] = isEmbed
        ? []
        : (THINKING_RULES[typeId] || (() => defaultEfforts || []))(lower, defaultEfforts || []);
      // 思考域分离：能力声明 supportsThinking + 档位声明 thinkingEfforts
      // （空档位 = 不能思考 → supportsThinking: false；非空 → true + 显式菜单）
      if (!isEmbed) {
        entry.supportsThinking = efforts.length > 0;
        if (efforts.length > 0) {
          entry.thinkingEfforts = efforts;
        }
      }
      if (m.config && Object.keys(m.config).length > 0) {
        entry.config = m.config;
      }
      return entry;
    });

    const data: Record<string, unknown> = {
      type: typeId,
      name: metadata.name,
      description: metadata.description || undefined,
      apiKeyUrl: metadata.apiKeyUrl || undefined,
      avatarUrl: metadata.avatarUrl || undefined,
      protocol: metadata.protocols[0],
      defaultApiUrl: metadata.defaultApiUrl,
    };
    if (Object.keys(thinking).length > 0) {
      data.thinking = thinking;
    }
    if (models.length > 0) {
      data.models = models;
    }

    const header: string[] = [
      `# ${metadata.name} 类型目录（bundled 预置，随应用版本分发）`,
      `# 此文件是「可添加供应商」模板与模型目录的权威数据；`,
      `# 实例文件按 modelName 条目级继承并覆盖，目录更新自动流到未覆盖的实例`,
    ];
    if (metadata.description) {
      header.push(`# ${metadata.description}`);
    }
    if (metadata.apiKeyUrl) {
      header.push(`# API Key 获取: ${metadata.apiKeyUrl}`);
    }

    const body = yaml.dump(data, { lineWidth: -1, noRefs: true });
    fs.writeFileSync(outFile, header.join('\n') + '\n' + body, 'utf8');
    created += 1;
    console.log(`generated ${path.relative(root, outFile)}`);
  }

  console.log(`done: ${created} generated, ${skipped} skipped (already exist)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
