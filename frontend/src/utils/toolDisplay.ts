import { type Component } from 'vue';
import {
  Wrench24Filled, Edit32Filled, Search16Regular, BookOpen24Filled, BookSearch24Regular,
  Code24Regular, WindowWrench16Regular,
} from '@vicons/fluent';
import Terminal from '@/components/icons/Terminal.vue';
import { parse as partialParse } from 'partial-json';

export interface ToolCall {
  name?: string;
  arguments?: any;
  args?: any;
  outcome?: 'success' | 'error' | 'rejected' | 'aborted';
  metadata?: { [key: string]: any };
}

export interface InlineContentConfig {
  key: string;
  mode: 'text' | 'code';
  language?: string;
}

export interface ToolDisplayConfig {
  text: { executing: string; completed: string };
  /** 聚合展示文案，{n} 为数量占位符，如 "正在执行{n}条命令" */
  aggregate?: string;
  argsKey?: string;
  icon?: Component;
  inlineContent?: InlineContentConfig;
}

export const DEFAULT_CONFIG: ToolDisplayConfig = {
  text: { executing: '正在调用工具', completed: '已调用工具' },
  aggregate: '正在执行{n}个步骤',
  icon: Wrench24Filled,
};

export const TOOL_DISPLAY_MAP: Record<string, ToolDisplayConfig> = {
  read:    { text: { executing: '正在读取文件', completed: '已读取文件' }, aggregate: '正在读取{n}个文件', argsKey: 'file_path', icon: BookOpen24Filled },
  glob:    { text: { executing: '正在搜索文件', completed: '已搜索文件' }, aggregate: '正在执行{n}次搜索', argsKey: 'pattern', icon: Search16Regular },
  write:   { text: { executing: '正在写入文件', completed: '已写入文件' }, aggregate: '正在写入{n}个文件', argsKey: 'file_path', icon: Edit32Filled, inlineContent: { key: 'content', mode: 'code' } },
  edit:    { text: { executing: '正在替换文本', completed: '已替换文本' }, aggregate: '正在编辑{n}个文件', argsKey: 'file_path', icon: Edit32Filled },
  delete:  { text: { executing: '正在删除文件', completed: '已删除文件' }, aggregate: '正在删除{n}个文件', argsKey: 'path', icon: Edit32Filled },
  grep:    { text: { executing: '正在搜索内容', completed: '已搜索内容' }, aggregate: '正在执行{n}次搜索', argsKey: 'pattern', icon: Search16Regular },

  browser_navigate:   { text: { executing: '正在访问网页', completed: '已访问网页' }, argsKey: 'url', icon: WindowWrench16Regular },
  browser_tabs:       { text: { executing: '正在管理标签', completed: '已管理标签' }, argsKey: 'action', icon: WindowWrench16Regular },
  browser_snapshot:   { text: { executing: '正在获取快照', completed: '已获取快照' }, argsKey: 'type', icon: WindowWrench16Regular },
  browser_interact:   { text: { executing: '正在执行交互', completed: '已执行交互' }, argsKey: 'action', icon: WindowWrench16Regular },
  browser_evaluate:   { text: { executing: '正在执行脚本', completed: '已执行脚本' }, argsKey: 'code', icon: Code24Regular },
  browser_history:    { text: { executing: '正在导航', completed: '已导航' }, argsKey: 'action', icon: WindowWrench16Regular },
  browser_console:    { text: { executing: '正在查看日志', completed: '已查看日志' }, icon: WindowWrench16Regular },
  browser_screenshot: { text: { executing: '正在截图', completed: '已截图' }, icon: WindowWrench16Regular },

  image_recognize:         { text: { executing: '正在识别图片', completed: '已识别图片' }, argsKey: 'image_id', icon: Search16Regular },
  image_recognize_by_path: { text: { executing: '正在识别图片', completed: '已识别图片' }, argsKey: 'image_path', icon: Search16Regular },

  memory: { text: { executing: '正在编辑记忆', completed: '已编辑记忆' }, argsKey: 'action', icon: Wrench24Filled },
  plan:   { text: { executing: '正在管理计划', completed: '已管理计划' }, argsKey: 'action', icon: Wrench24Filled },

  get_current_time: { text: { executing: '正在获取时间', completed: '已获取时间' }, icon: Wrench24Filled },

  web_search: { text: { executing: '正在搜索网络', completed: '已搜索网络' }, argsKey: 'q', icon: Search16Regular },
  web_parser: { text: { executing: '正在读取网页', completed: '已读取网页' }, argsKey: 'url', icon: WindowWrench16Regular },

  terminal: { text: { executing: '正在执行命令', completed: '已执行命令' }, aggregate: '正在执行{n}条命令', argsKey: 'command', icon: Terminal },
  process:  { text: { executing: '正在管理进程', completed: '已管理进程' }, argsKey: 'action', icon: Terminal },

  doc_parse:        { text: { executing: '正在解析文档', completed: '已解析文档' }, argsKey: 'file_path', icon: BookOpen24Filled },
  doc_batch_parse:  { text: { executing: '正在批量解析文档', completed: '已批量解析文档' }, icon: BookOpen24Filled },

  clear_session: { text: { executing: '正在清空会话', completed: '已清空会话' }, icon: Wrench24Filled },

  kb_search:       { text: { executing: '正在搜索知识库', completed: '已搜索知识库' }, argsKey: 'query', icon: BookSearch24Regular },
  kb_list_files:   { text: { executing: '正在列出文件', completed: '已列出文件' }, icon: BookSearch24Regular },
  kb_get_chunks:   { text: { executing: '正在获取分块', completed: '已获取分块' }, argsKey: 'file_id', icon: BookSearch24Regular },
  kb_add_document: { text: { executing: '正在添加文档', completed: '已添加文档' }, icon: BookSearch24Regular },

  scheduler_create_task: { text: { executing: '正在创建定时任务', completed: '已创建定时任务' }, argsKey: 'name', icon: Wrench24Filled },
  scheduler_list_tasks:  { text: { executing: '正在获取任务列表', completed: '已获取任务列表' }, icon: Wrench24Filled },
  scheduler_delete_task: { text: { executing: '正在删除定时任务', completed: '已删除定时任务' }, icon: Wrench24Filled },
  scheduler_toggle_task: { text: { executing: '正在切换任务状态', completed: '已切换任务状态' }, icon: Wrench24Filled },

  skill_lean: { text: { executing: '正在读取技能', completed: '已读取技能' }, argsKey: 'name', icon: BookOpen24Filled },

  subagent_spawn:   { text: { executing: '正在创建子代理', completed: '已创建子代理' }, argsKey: 'name', icon: Wrench24Filled },
  subagent_manager: { text: { executing: '正在管理子代理', completed: '已管理子代理' }, argsKey: 'action', icon: Wrench24Filled },

  tool_learn: { text: { executing: '正在加载工具包', completed: '已加载工具包' }, argsKey: 'name', icon: Wrench24Filled },
  tool_use:   { text: { executing: '正在调用工具', completed: '已调用工具' }, argsKey: 'tool_name', icon: Wrench24Filled },
};

export function resolveToolName(tool: ToolCall): string {
  if (tool.name === 'tool_use') {
    try {
      const parsed = typeof tool.arguments === 'string' ? partialParse(tool.arguments) : tool.arguments;
      if (parsed?.tool_name) return parsed.tool_name;
    } catch { }
  }
  return tool.name || '';
}

export function getToolConfig(tool: ToolCall): ToolDisplayConfig {
  const name = resolveToolName(tool);
  return TOOL_DISPLAY_MAP[name] || DEFAULT_CONFIG;
}

export function getToolIcon(tool: ToolCall): Component {
  return getToolConfig(tool).icon || DEFAULT_CONFIG.icon!;
}

export function getToolActionText(tool: ToolCall, isExecuting: boolean): string {
  const config = getToolConfig(tool);
  if (tool.outcome === 'aborted') {
    return `${config.text.completed}（已终止）`;
  }
  return isExecuting ? config.text.executing : config.text.completed;
}

export function formatArgSummary(value: any): string {
  if (typeof value !== 'string') return String(value);
  if (value.includes('/') || value.includes('\\')) {
    return value.split(/[\/\\]/).pop() || value;
  }
  return value.length > 60 ? value.substring(0, 60) + '...' : value;
}

export function getToolArgs(tool: ToolCall): any {
  if (tool.name === 'tool_use') {
    try {
      const parsed = typeof tool.arguments === 'string' ? partialParse(tool.arguments) : tool.arguments;
      if (parsed?.arguments) return parsed.arguments;
    } catch { }
  }
  return tool.arguments ?? tool.args;
}

export function getArgsText(tool: ToolCall): string | undefined {
  const params = getToolArgs(tool);
  if (!params) return undefined;

  let parsedParams = params;
  if (typeof params === 'string') {
    try {
      parsedParams = partialParse(params);
    } catch {
      return undefined;
    }
  }

  if (!parsedParams || typeof parsedParams !== 'object') return undefined;

  const config = getToolConfig(tool);
  const isKnownTool = resolveToolName(tool) in TOOL_DISPLAY_MAP;

  if (config.argsKey && parsedParams[config.argsKey]) {
    return formatArgSummary(parsedParams[config.argsKey]);
  }

  if (isKnownTool) return undefined;

  for (const value of Object.values(parsedParams)) {
    if (typeof value === 'string' && value.length > 0) {
      return formatArgSummary(value);
    }
  }
  return undefined;
}

export function getInlineContent(tool: ToolCall): string | undefined {
  const config = getToolConfig(tool);
  if (!config.inlineContent) return undefined;

  const params = getToolArgs(tool);
  if (!params) return undefined;

  let parsedParams = params;
  if (typeof params === 'string') {
    try {
      parsedParams = partialParse(params);
    } catch {
      return undefined;
    }
  }

  if (!parsedParams || typeof parsedParams !== 'object') return undefined;

  const value = parsedParams[config.inlineContent.key];
  if (typeof value !== 'string' || value.length === 0) return undefined;

  return value;
}

export function countSteps(items: any[]): number {
  return items.reduce((sum, item) => {
    if (item.type === 'tool' && item.toolCalls?.length) {
      return sum + item.toolCalls.length;
    }
    return sum + 1;
  }, 0);
}
