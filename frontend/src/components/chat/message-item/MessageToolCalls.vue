<template>
  <div class="process-section tool-calls-section">
    <div class="" v-for="(tool, toolIndex) in toolCalls" :key="toolIndex">
      <!-- 循环展示每个工具调用 -->
      <div
        class="flex items-center text-sm text-gray-700 dark:text-[#8b8d95] cursor-pointer font-medium transition-colors duration-200 min-w-0"
        @click.stop="openSingleToolDialog(toolIndex)">
        <el-icon v-if="isExecuting" class="shrink-0 animate-spin" size="14">
          <SpinnerIos20Filled />
        </el-icon>
        <el-icon v-else-if="tool.outcome === 'error' || tool.outcome === 'rejected'" class="shrink-0" size="14" style="color: #f56c6c;">
          <ErrorCircle16Regular />
        </el-icon>
        <el-icon v-else-if="tool.outcome === 'aborted'" class="shrink-0" size="14" style="color: #c0c4cc;">
          <ErrorCircle16Regular />
        </el-icon>
        <el-icon v-else class="shrink-0" size="14">
          <component :is="getToolIcon(tool)" class="text-gray-500" />
        </el-icon>
        <div class="ml-2 truncate text-gray-400 dark:text-gray-500 ">
          <span :class="tool.outcome === 'aborted' ? 'text-gray-400 dark:text-gray-500 font-medium' : 'text-gray-700 dark:text-gray-300 font-medium'">{{ getActionText(tool, toolIndex) }}</span>
          <span v-if="getArgsText(tool)" class="text-sm ml-2">{{ getArgsText(tool)
          }}</span>
        </div>
      </div>
      <div v-if="toolIndex < toolCalls.length - 1" class="process-in-timeline border-l border-gray-300 dark:border-gray-700 min-h-2 ml-1.5"></div>
    </div>
    <div class="process-timeline border-l border-gray-300 dark:border-gray-700 min-h-2 ml-1.5"></div>
  </div>


  <!-- 单个工具详情对话框 -->
  <ElDialog v-if="keepElement && selectedToolIndex !== null" v-model="showDialog"
    :title="`工具调用详情 #${selectedToolIndex + 1}`" width="700px" :close-on-click-modal="true" destroy-on-close
    :append-to-body="true" class="tool-dialog" @closed="keepElement = false">
    <div class="tool-dialog-content">
      <!-- 加载状态 -->
      <div v-if="isLoadingDetails" class="flex items-center justify-center py-8">
        <el-icon size="24" class="animate-spin text-blue-500 mr-2">
          <Loading />
        </el-icon>
        <span class="text-gray-500">加载工具详情中...</span>
      </div>
      <div v-else-if="selectedTool" class="tool-call-detail">
        <div class="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
          <el-icon v-if="isExecuting" size="18" class="text-blue-500 animate-spin">
            <SpinnerIos20Filled />
          </el-icon>
          <el-icon v-else-if="selectedTool?.outcome === 'error' || selectedTool?.outcome === 'rejected'" size="18" style="color:#f56c6c">
            <ErrorCircle16Regular />
          </el-icon>
          <el-icon v-else size="18" class="text-blue-500">
            <component :is="getToolIcon(selectedTool)" />
          </el-icon>
          <span class="text-base font-semibold text-gray-800 dark:text-gray-200">
            {{ getToolDisplayName(selectedTool) }}
          </span>
          <span class="text-xs text-gray-400 ml-auto">
            #{{ selectedToolIndex + 1 }}
          </span>
        </div>

        <div v-if="getToolArgs(selectedTool)" class="mb-4">
          <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
            <el-icon size="14" class="mr-1">
              <SettingsOutlined />
            </el-icon>
            调用参数
          </div>
          <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <div v-if="isSimpleParams(getToolArgs(selectedTool))" class="params-table">
              <div class="param-header py-2 border-b border-gray-200 dark:border-gray-700">
                <span class="param-key text-sm font-semibold text-gray-800 dark:text-gray-200">参数</span>
                <span class="param-value text-sm font-semibold text-gray-800 dark:text-gray-200 ml-4">值</span>
              </div>
              <div v-for="(value, key) in parseParams(getToolArgs(selectedTool))" :key="key"
                class="param-row py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <span class="param-key text-sm font-medium text-gray-700 dark:text-gray-300">{{ key }}</span>
                <span class="param-value text-sm text-gray-600 dark:text-gray-400 ml-4">{{ formatParamValue(value)
                }}</span>
              </div>
            </div>
            <pre v-else class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
                <code>{{ formatToolArgs(getToolArgs(selectedTool)) }}</code>
              </pre>
          </div>
        </div>

        <div v-if="currentToolResponses && currentToolResponses[selectedToolIndex]" class="mt-4">
          <div class="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 flex items-center">
            <el-icon v-if="selectedTool?.outcome === 'error' || selectedTool?.outcome === 'rejected'" size="14" class="mr-1" style="color:#f56c6c">
              <ErrorCircle16Regular />
            </el-icon>
            <el-icon v-else size="14" class="mr-1 text-green-500">
              <CheckCircleOutlined />
            </el-icon>
            <span v-if="selectedTool?.outcome === 'error' || selectedTool?.outcome === 'rejected'">执行失败</span>
            <span v-else>执行结果</span>
          </div>
          <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <!-- JSON 解码成功且为简单对象 → 表格展示 -->
            <div v-if="isSimpleResult(currentToolResponses[selectedToolIndex])" class="params-table">
              <div class="param-header py-2 border-b border-gray-200 dark:border-gray-700">
                <span class="param-key text-sm font-semibold text-gray-800 dark:text-gray-200">字段</span>
                <span class="param-value text-sm font-semibold text-gray-800 dark:text-gray-200 ml-4">值</span>
              </div>
              <div v-for="(value, key) in parseResult(currentToolResponses[selectedToolIndex])" :key="key"
                class="param-row py-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <span class="param-key text-sm font-medium text-gray-700 dark:text-gray-300">{{ key }}</span>
                <span class="param-value text-sm text-gray-600 dark:text-gray-400 ml-4">{{ formatParamValue(value) }}</span>
              </div>
            </div>
            <!-- JSON 解码失败或复杂对象 → pre 展示 -->
            <pre v-else class="text-sm overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">{{
              formatToolResponse(currentToolResponses[selectedToolIndex])
            }}</pre>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <span class="dialog-footer">
        <el-button @click="closeDialog">关闭</el-button>
      </span>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { ElIcon, ElDialog, ElButton } from 'element-plus';
import { SettingsOutlined, CheckCircleOutlined } from '@vicons/material';
import {
  Wrench24Filled, SpinnerIos20Filled, ErrorCircle16Regular,
  Edit32Filled, Search16Regular, BookOpen24Filled, BookSearch24Regular,
  Code24Regular, WindowWrench16Regular,
} from '@vicons/fluent';
// @ts-ignore - icons 组件尚未迁移到 TypeScript
import { Loading } from '@/components/icons';
import Terminal from '@/components/icons/Terminal.vue';
import { parse as partialParse } from 'partial-json';
import { apiService } from '@/services/ApiService';
import { usePopup } from '@/composables/usePopup';

interface ToolCall {
  name?: string;
  arguments?: any;
  args?: any;
  outcome?: 'success' | 'error' | 'rejected' | 'aborted';
  metadata?: {
    [key: string]: any;
  };
}

const props = defineProps<{
  toolCalls: ToolCall[];
  toolResponses?: any[];
  isExecuting?: boolean;
  isStreaming?: boolean;
  contentId?: string;
}>();

const { toast } = usePopup();

// ── 统一工具展示映射表 ──
// 以 tool.name 为 key，包含文案、参数提取字段、图标
// 未命中的工具 fallback：文案=正在/已调用工具，参数=自动取第一个字符串字段，图标=Wrench24Filled

interface ToolDisplayConfig {
  text: { executing: string; completed: string };
  argsKey?: string;
  icon?: Component;
}

const DEFAULT_CONFIG: ToolDisplayConfig = {
  text: { executing: '正在调用工具', completed: '已调用工具' },
  icon: Wrench24Filled,
};

const TOOL_DISPLAY_MAP: Record<string, ToolDisplayConfig> = {
  // ── 文件工具 ──
  read:    { text: { executing: '正在读取文件', completed: '已读取文件' }, argsKey: 'file_path', icon: BookOpen24Filled },
  glob:    { text: { executing: '正在搜索文件', completed: '已搜索文件' }, argsKey: 'pattern', icon: Search16Regular },
  write:   { text: { executing: '正在写入文件', completed: '已写入文件' }, argsKey: 'file_path', icon: Edit32Filled },
  edit:    { text: { executing: '正在替换文本', completed: '已替换文本' }, argsKey: 'file_path', icon: Edit32Filled },
  delete:  { text: { executing: '正在删除文件', completed: '已删除文件' }, argsKey: 'path', icon: Edit32Filled },
  grep:    { text: { executing: '正在搜索内容', completed: '已搜索内容' }, argsKey: 'pattern', icon: Search16Regular },

  // ── 浏览器工具 ──
  browser_navigate:   { text: { executing: '正在访问网页', completed: '已访问网页' }, argsKey: 'url', icon: WindowWrench16Regular },
  browser_tabs:       { text: { executing: '正在管理标签', completed: '已管理标签' }, argsKey: 'action', icon: WindowWrench16Regular },
  browser_snapshot:   { text: { executing: '正在获取快照', completed: '已获取快照' }, argsKey: 'type', icon: WindowWrench16Regular },
  browser_interact:   { text: { executing: '正在执行交互', completed: '已执行交互' }, argsKey: 'action', icon: WindowWrench16Regular },
  browser_evaluate:   { text: { executing: '正在执行脚本', completed: '已执行脚本' }, argsKey: 'code', icon: Code24Regular },
  browser_history:    { text: { executing: '正在导航', completed: '已导航' }, argsKey: 'action', icon: WindowWrench16Regular },
  browser_console:    { text: { executing: '正在查看日志', completed: '已查看日志' }, icon: WindowWrench16Regular },
  browser_screenshot: { text: { executing: '正在截图', completed: '已截图' }, icon: WindowWrench16Regular },

  // ── 图像识别 ──
  image_recognize:         { text: { executing: '正在识别图片', completed: '已识别图片' }, argsKey: 'image_id', icon: Search16Regular },
  image_recognize_by_path: { text: { executing: '正在识别图片', completed: '已识别图片' }, argsKey: 'image_path', icon: Search16Regular },

  // ── 记忆 / 计划 ──
  memory: { text: { executing: '正在编辑记忆', completed: '已编辑记忆' }, argsKey: 'action', icon: Wrench24Filled },
  plan:   { text: { executing: '正在管理计划', completed: '已管理计划' }, argsKey: 'action', icon: Wrench24Filled },

  // ── 时间 ──
  get_current_time: { text: { executing: '正在获取时间', completed: '已获取时间' }, icon: Wrench24Filled },

  // ── 网络搜索 ──
  web_search: { text: { executing: '正在搜索网络', completed: '已搜索网络' }, argsKey: 'q', icon: Search16Regular },
  web_parser: { text: { executing: '正在读取网页', completed: '已读取网页' }, argsKey: 'url', icon: WindowWrench16Regular },

  // ── Shell ──
  terminal: { text: { executing: '正在执行命令', completed: '已执行命令' }, argsKey: 'command', icon: Terminal },
  process:  { text: { executing: '正在管理进程', completed: '已管理进程' }, argsKey: 'action', icon: Terminal },

  // ── 文档解析 ──
  doc_parse:        { text: { executing: '正在解析文档', completed: '已解析文档' }, argsKey: 'file_path', icon: BookOpen24Filled },
  doc_batch_parse:  { text: { executing: '正在批量解析文档', completed: '已批量解析文档' }, icon: BookOpen24Filled },

  // ── 会话管理 ──
  clear_session: { text: { executing: '正在清空会话', completed: '已清空会话' }, icon: Wrench24Filled },

  // ── 知识库 ──
  kb_search:       { text: { executing: '正在搜索知识库', completed: '已搜索知识库' }, argsKey: 'query', icon: BookSearch24Regular },
  kb_list_files:   { text: { executing: '正在列出文件', completed: '已列出文件' }, icon: BookSearch24Regular },
  kb_get_chunks:   { text: { executing: '正在获取分块', completed: '已获取分块' }, argsKey: 'file_id', icon: BookSearch24Regular },
  kb_add_document: { text: { executing: '正在添加文档', completed: '已添加文档' }, icon: BookSearch24Regular },

  // ── 定时任务 ──
  scheduler_create_task: { text: { executing: '正在创建定时任务', completed: '已创建定时任务' }, argsKey: 'name', icon: Wrench24Filled },
  scheduler_list_tasks:  { text: { executing: '正在获取任务列表', completed: '已获取任务列表' }, icon: Wrench24Filled },
  scheduler_delete_task: { text: { executing: '正在删除定时任务', completed: '已删除定时任务' }, icon: Wrench24Filled },
  scheduler_toggle_task: { text: { executing: '正在切换任务状态', completed: '已切换任务状态' }, icon: Wrench24Filled },

  // ── 技能 ──
  skill_lean: { text: { executing: '正在读取技能', completed: '已读取技能' }, argsKey: 'name', icon: BookOpen24Filled },

  // ── 子代理 ──
  subagent_spawn:   { text: { executing: '正在创建子代理', completed: '已创建子代理' }, argsKey: 'name', icon: Wrench24Filled },
  subagent_manager: { text: { executing: '正在管理子代理', completed: '已管理子代理' }, argsKey: 'action', icon: Wrench24Filled },

  // ── 通用工具 ──
  tool_learn: { text: { executing: '正在加载工具包', completed: '已加载工具包' }, argsKey: 'name', icon: Wrench24Filled },
  tool_use:   { text: { executing: '正在调用工具', completed: '已调用工具' }, argsKey: 'tool_name', icon: Wrench24Filled },
};

// ── 工具名解析（解包 tool_use）──

/**
 * 解析工具的真实名称
 * tool_use 包装的工具需从 arguments 中提取 tool_name
 */
function resolveToolName(tool: ToolCall): string {
  if (tool.name === 'tool_use') {
    try {
      const parsed = typeof tool.arguments === 'string' ? partialParse(tool.arguments) : tool.arguments;
      if (parsed?.tool_name) return parsed.tool_name;
    } catch { }
  }
  return tool.name || '';
}

function getToolConfig(tool: ToolCall): ToolDisplayConfig {
  const name = resolveToolName(tool);
  return TOOL_DISPLAY_MAP[name] || DEFAULT_CONFIG;
}

// ── 执行状态 ──

const isExecuting = computed(() => {
  if (props.isStreaming === false) return false;
  if (props.toolResponses && props.toolResponses.length > 0) return false;
  if (props.toolCalls?.some((tc) => tc.outcome)) return false;
  return true;
});

const isToolExecuting = (tool: ToolCall, index: number): boolean => {
  if (tool.outcome) return false;
  if (props.isStreaming === false) return false;
  if (props.toolResponses && props.toolResponses[index]) return false;
  return true;
};

// ── 展示文案 ──

const getActionText = (tool: ToolCall, toolIndex: number): string => {
  const config = getToolConfig(tool);
  const executing = isToolExecuting(tool, toolIndex);

  if (tool.outcome === 'aborted') {
    return `${config.text.completed}（已终止）`;
  }

  return executing ? config.text.executing : config.text.completed;
};

const getToolIcon = (tool: ToolCall): Component => {
  return getToolConfig(tool).icon || DEFAULT_CONFIG.icon!;
};

// ── 参数摘要 ──

function formatArgSummary(value: any): string {
  if (typeof value !== 'string') return String(value);
  if (value.includes('/') || value.includes('\\')) {
    return value.split(/[\/\\]/).pop() || value;
  }
  return value.length > 60 ? value.substring(0, 60) + '...' : value;
}

const getArgsText = (tool: ToolCall): string | undefined => {
  const params = getToolArgs(tool);
  if (!params) return undefined;

  // arguments 可能是 JSON 字符串，需要先解析
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

  // 已知工具：argsKey 未命中时返回空（可能是参数尚未输出完，或该工具本身无参数展示需求）
  if (isKnownTool) return undefined;

  // 未知工具：降级取第一个有值的字符串参数
  for (const value of Object.values(parsedParams)) {
    if (typeof value === 'string' && value.length > 0) {
      return formatArgSummary(value);
    }
  }
  return undefined;
};

// ── 工具参数解析 ──

/**
 * 获取工具的实际参数
 * tool_use 提取内层 arguments，其他直接返回
 */
const getToolArgs = (tool: ToolCall): any => {
  if (tool.name === 'tool_use') {
    try {
      const parsed = typeof tool.arguments === 'string' ? partialParse(tool.arguments) : tool.arguments;
      if (parsed?.arguments) return parsed.arguments;
    } catch { }
  }
  return tool.arguments ?? tool.args;
};

const getToolDisplayName = (tool: ToolCall): string => {
  const name = resolveToolName(tool);
  if (tool.name === 'tool_use' && name !== tool.name) {
    return `tool_use.${name}`;
  }
  return tool.name || 'Unknown Tool';
};

// ── 弹窗 & 懒加载 ──

const showDialog = ref(false);
const keepElement = ref(false);
const selectedToolIndex = ref<number | null>(null);
const isLoadingDetails = ref(false);
const loadedToolCalls = ref<ToolCall[] | null>(null);
const loadedToolResponses = ref<any[] | null>(null);

const selectedTool = computed(() => {
  if (selectedToolIndex.value === null) return null;
  if (loadedToolCalls.value && loadedToolCalls.value[selectedToolIndex.value]) {
    return loadedToolCalls.value[selectedToolIndex.value];
  }
  if (props.toolCalls) {
    return props.toolCalls[selectedToolIndex.value];
  }
  return null;
});

const currentToolResponses = computed(() => {
  if (loadedToolResponses.value) return loadedToolResponses.value;
  return props.toolResponses;
});

const needsLazyLoad = computed(() => {
  if (!props.contentId) return false;
  if (isExecuting.value) return false;
  return true;
});

async function loadToolDetails() {
  if (!props.contentId || !needsLazyLoad.value) return;
  if (isLoadingDetails.value) return;

  isLoadingDetails.value = true;
  try {
    const result = await apiService.fetchMessageContentToolDetails(props.contentId);
    loadedToolCalls.value = result.toolCalls || [];
    loadedToolResponses.value = result.toolCallsResponse || [];
  } catch (error: any) {
    console.error('加载工具调用详情失败:', error);
    toast.error('加载工具详情失败');
  } finally {
    isLoadingDetails.value = false;
  }
}

watch(showDialog, (newVal) => {
  if (newVal && needsLazyLoad.value) {
    loadToolDetails();
  }
});

const openSingleToolDialog = (index: number) => {
  selectedToolIndex.value = index;
  loadedToolCalls.value = null;
  loadedToolResponses.value = null;
  showDialog.value = true;
  keepElement.value = true;
};

const closeDialog = () => {
  showDialog.value = false;
  selectedToolIndex.value = null;
};

// ── 参数 / 结果格式化 ──

const isSimpleParams = (args: any): boolean => {
  try {
    const parsed = typeof args === 'string' ? partialParse(args) : args;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
};

const parseParams = (args: any): Record<string, any> => {
  try {
    return typeof args === 'string' ? partialParse(args) : args;
  } catch {
    return {};
  }
};

const formatParamValue = (value: any): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

const formatToolArgs = (args: any): string => {
  if (!args) return '{}';
  try {
    const parsed = typeof args === 'string' ? partialParse(args) : args;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(args);
  }
};

const extractResultContent = (response: any): any => {
  if (!response) return null;
  try {
    const parsed = typeof response === 'string' ? JSON.parse(response) : response;
    if (parsed.content) {
      try {
        return typeof parsed.content === 'string' ? JSON.parse(parsed.content) : parsed.content;
      } catch {
        return parsed.content;
      }
    }
    return parsed;
  } catch {
    return null;
  }
};

const formatToolResponse = (response: any): string => {
  if (!response) return '无响应';
  const content = extractResultContent(response);
  if (content) {
    if (typeof content === 'string') return content;
    return JSON.stringify(content, null, 2);
  }
  return String(response);
};

const isSimpleResult = (response: any): boolean => {
  const content = extractResultContent(response);
  if (!content) return false;
  return typeof content === 'object' && content !== null && !Array.isArray(content) && Object.keys(content).length > 0;
};

const parseResult = (response: any): Record<string, any> => {
  const content = extractResultContent(response);
  return content && typeof content === 'object' ? content : {};
};
</script>

<style scoped>
.tool-dialog-content {
  line-height: 1.6;
}

.tool-call-detail pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

.tool-call-detail code {
  font-size: 13px;
}

.params-table {
  display: flex;
  flex-direction: column;
}

.param-header {
  display: flex;
  align-items: baseline;
}

.param-row {
  display: flex;
  align-items: baseline;
}

.param-key {
  min-width: 120px;
  flex-shrink: 0;
}

.param-value {
  flex: 1;
  word-break: break-word;
  white-space: pre-wrap;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
