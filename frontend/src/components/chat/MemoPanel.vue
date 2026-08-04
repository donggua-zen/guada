<template>
  <div class="flex flex-col gap-4">
    <!-- ============ 上下文统计卡片 ============ -->
    <template v-if="tokenStats">
      <div>
        <!-- 使用率进度条 -->
        <div class="mb-3">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">上下文使用率</span>
              <LTooltip content="上下文为估算值，仅供参考，与实际值可能存在差异" placement="top">
                <el-icon class="text-gray-400 dark:text-[#8b8d95] hover:text-gray-600 dark:hover:text-[#a8aab0] cursor-help transition-colors" :size="14">
                  <QuestionFilled />
                </el-icon>
              </LTooltip>
            </div>
            <span class="text-base font-bold" :class="usageColorClass">
              {{ tokenStats.percentage }}%
            </span>
          </div>
          <el-progress :percentage="tokenStats.percentage" :color="progressColor" :stroke-width="14"
            :show-text="false" />
          <div class="flex items-center gap-2 mt-1.5">
            <span class="text-xs text-gray-400 dark:text-[#8b8d95]">
              {{ tokenStats.usedTokens.toLocaleString() }} / {{ tokenStats.totalTokens.toLocaleString() }} · {{ tokenStats.messageCount }}条消息
            </span>
            <el-button v-if="tokenStats.breakdown" size="small" text @click="showBreakdown = !showBreakdown"
              class="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 !px-1 !py-0 !h-auto !text-xs">
              详情
            </el-button>
          </div>
        </div>

        <!-- 细分统计：垂直列表 -->
        <div v-if="tokenStats.breakdown && showBreakdown" class="space-y-2.5 mb-3">
          <div v-for="item in breakdownItems" :key="item.key">
            <div class="flex items-center justify-between mb-1">
              <span class="text-xs text-gray-600 dark:text-[#a8aab0]">{{ item.label }}</span>
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium" :class="item.colorClass">{{ item.tokens.toLocaleString() }}</span>
                <span class="text-xs text-gray-400 dark:text-[#8b8d95] w-10 text-right">{{ item.percentage }}%</span>
              </div>
            </div>
            <div class="h-1.5 bg-gray-200 dark:bg-[#2a2c30] rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-300" :class="item.barClass" :style="{ width: item.percentage + '%' }" />
            </div>
          </div>
        </div>

        




























        <!-- 操作按钮 -->
        <div class="flex gap-2 pt-3">
          <el-button size="small" @click="loadTokenStats" :loading="loadingStats" class="flex-1">
            <el-icon class="mr-1">
              <Refresh />
            </el-icon>
            刷新
          </el-button>
          <el-button size="small" @click="handleCompress" :loading="isCompressing" class="flex-1">
            <el-icon class="mr-1">
              <MagicStick />
            </el-icon>
            {{ isCompressing ? '压缩中...' : '压缩' }}
          </el-button>
        </div>
      </div>
    </template>
    <template v-else>
      <el-empty description="加载中..." :image-size="60" />
    </template>

    <!-- ============ 最新压缩状态 ============ -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">最新压缩状态</h4>































































































































































































































































































































        <span class="text-xs text-gray-400 dark:text-[#8b8d95]">已压缩 {{ summaryTotal }} 次</span>
      </div>

      <template v-if="summaries.length > 0">
        <!-- 只显示最新一条 -->
        <div :key="summaries[0].id">
          











          <!-- 摘要内容 -->
          <div v-if="summaries[0].summaryContent"
            class="text-xs text-gray-700 dark:text-[#c8c9cd] whitespace-pre-wrap leading-relaxed mb-3 max-h-32 overflow-y-auto">
            {{ summaries[0].summaryContent }}
          </div>

          <!-- 统计信息区域 -->
          <div v-if="summaries[0].compressionStats || summaries[0].pruningMetadata"
            class="space-y-2 mb-3">
            <div
              v-if="summaries[0].compressionStats?.beforeTokenCount && summaries[0].compressionStats?.afterTokenCount"
              class="flex justify-between items-center text-xs">
              <span class="text-gray-600 dark:text-[#a8aab0]">Token</span>
              <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                {{ formatNumber(summaries[0].compressionStats.beforeTokenCount) }} → {{
                  formatNumber(summaries[0].compressionStats.afterTokenCount) }}
                <span class="text-green-600 dark:text-green-500 ml-1">
                  (-{{ formatNumber(summaries[0].compressionStats.beforeTokenCount -
                    summaries[0].compressionStats.afterTokenCount) }})
                </span>
              </span>
            </div>
            <div
              v-if="summaries[0].compressionStats?.beforeMessageCount && summaries[0].compressionStats?.afterMessageCount"
              class="flex justify-between items-center text-xs">
              <span class="text-gray-600 dark:text-[#a8aab0]">消息</span>
              <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                {{ summaries[0].compressionStats.beforeMessageCount }} → {{
                  summaries[0].compressionStats.afterMessageCount }}
              </span>
            </div>
            <div class="flex items-center gap-1.5 text-xs pt-1">
              <el-tag v-if="summaries[0].pruningMetadata" size="small" type="warning">仅裁剪</el-tag>
              <el-tag v-else-if="summaries[0].summaryContent" size="small" type="success">摘要压缩</el-tag>
              <span v-if="summaries[0].pruningMetadata" class="text-gray-500 dark:text-[#8b8d95]">
                {{ Object.keys(summaries[0].pruningMetadata).length }} 条
              </span>
            </div>
          </div>

          <div v-else-if="!summaries[0].summaryContent" class="text-xs text-gray-400 dark:text-[#8b8d95] italic mb-3">
            无摘要内容
          </div>

          




























          <!-- 底部信息：时间戳和操作按钮 -->
          <div class="flex items-center justify-between text-xs pt-3">
            <span class="text-gray-400 dark:text-[#8b8d95] truncate" :title="formatTime(summaries[0].createdAt)">
              {{ formatTime(summaries[0].createdAt) }}
            </span>
            <div class="flex gap-1">
              <el-button size="small" text @click="handleViewHistory"
                class="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                <el-icon><List /></el-icon>
                <span class="ml-1">历史</span>
              </el-button>
              <el-button size="small" text @click="handleEdit(summaries[0])"
                class="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20">
                <el-icon><Edit /></el-icon>
                <span class="ml-1">编辑</span>
              </el-button>
              <el-button size="small" text @click="handleDelete(summaries[0])"
                class="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20">
                <el-icon><Delete /></el-icon>
                <span class="ml-1">删除</span>
              </el-button>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <el-empty description="暂无压缩记录" :image-size="60" />
      </template>
    </div>

    <!-- 编辑摘要对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑摘要" width="600px" append-to-body>
      <el-input v-model="editingSummary.content" type="textarea" :rows="10" placeholder="请输入摘要内容" />
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="editDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveEdit">保存</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 压缩历史记录对话框 -->
    <el-dialog v-model="historyDialogVisible" title="压缩历史记录" width="800px" max-height="600px" append-to-body>
      <template v-if="summaries.length > 0">
        <div v-for="(summary, index) in summaries" :key="summary.id" class="mb-4 last:mb-0">
            <div class="rounded-lg border border-gray-200 dark:border-[#2a2c30] bg-white dark:bg-[#232428] p-4">
              <!-- 头部：序号和时间 -->
              <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-100 dark:border-[#2a2c30]">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">第 {{ summaryTotal - index }} 次压缩</span>
                  <el-tag size="small" :type="getStrategyTagType(summary.cleaningStrategy || 'unknown')">
                    {{ getStrategyLabel(summary.cleaningStrategy || 'unknown') }}
                  </el-tag>
                </div>
                <span class="text-xs text-gray-400 dark:text-[#8b8d95]">{{ formatTime(summary.createdAt) }}</span>
              </div>

              <!-- 摘要内容 -->
              <div v-if="summary.summaryContent" class="mb-3">
                <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-1">摘要内容：</div>
                <div class="text-xs text-gray-700 dark:text-[#c8c9cd] whitespace-pre-wrap leading-relaxed bg-gray-50 dark:bg-[#1e1f23] rounded p-3 max-h-40 overflow-y-auto">
                  {{ summary.summaryContent }}
                </div>
              </div>

              <!-- 统计信息 -->
              <div v-if="summary.compressionStats || summary.pruningMetadata" class="space-y-2">
                <div class="text-xs text-gray-500 dark:text-[#8b8d95]">压缩统计：</div>
                <div class="bg-gray-50 dark:bg-[#1e1f23] rounded p-3 space-y-2">
                  <!-- Token 统计 -->
                  <div v-if="summary.compressionStats?.beforeTokenCount && summary.compressionStats?.afterTokenCount" class="flex justify-between items-center text-xs">
                    <span class="text-gray-600 dark:text-[#a8aab0]">Token 数量：</span>
                    <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                      {{ formatNumber(summary.compressionStats.beforeTokenCount) }} → {{ formatNumber(summary.compressionStats.afterTokenCount) }}
                      <span class="text-green-600 dark:text-green-500 ml-1">(-{{ formatNumber(summary.compressionStats.beforeTokenCount - summary.compressionStats.afterTokenCount) }})</span>
                    </span>
                  </div>
                  
                  <!-- 消息数量统计 -->
                  <div v-if="summary.compressionStats?.beforeMessageCount && summary.compressionStats?.afterMessageCount" class="flex justify-between items-center text-xs">
                    <span class="text-gray-600 dark:text-[#a8aab0]">消息数量：</span>
                    <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                      {{ summary.compressionStats.beforeMessageCount }} → {{ summary.compressionStats.afterMessageCount }}
                    </span>
                  </div>

                  <!-- 压缩率 -->
                  <div v-if="summary.compressionStats?.beforeTokenCount && summary.compressionStats?.afterTokenCount" class="flex justify-between items-center text-xs">
                    <span class="text-gray-600 dark:text-[#a8aab0]">压缩率：</span>
                    <span class="font-medium text-green-600 dark:text-green-500">
                      {{ ((1 - summary.compressionStats.afterTokenCount / summary.compressionStats.beforeTokenCount) * 100).toFixed(2) }}%
                    </span>
                  </div>

                  <!-- 裁剪数量（只在没有摘要时显示） -->
                  <div v-if="summary.pruningMetadata" class="flex justify-between items-center gap-2 text-xs pt-1">
                    <span class="text-gray-600 dark:text-[#a8aab0]">裁剪数量：</span>
                    <span class="text-gray-500 dark:text-[#8b8d95]">{{ Object.keys(summary.pruningMetadata).length }} 条</span>
                  </div>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div v-if="summary.summaryContent" class="flex justify-end gap-2 mt-3 pt-2 border-t border-gray-100 dark:border-[#2a2c30]">
                <el-button 
                  size="small" 
                  text 
                  @click="handleEditFromHistory(summary)"
                  class="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
                >
                  <el-icon><Edit /></el-icon>
                  <span class="ml-1">编辑</span>
                </el-button>
                <el-button 
                  size="small" 
                  text 
                  @click="handleDeleteFromHistory(summary)"
                  class="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300"
                >
                  <el-icon><Delete /></el-icon>
                  <span class="ml-1">删除</span>
                </el-button>
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <el-empty description="暂无压缩记录" :image-size="80" />
        </template>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="historyDialogVisible = false">关闭</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useSessionTokenStats } from '@/composables/useSessionTokenStats';
import { useDebounceFn } from '@vueuse/core';
import { useSessionStore } from '@/stores/session';
import { apiService } from '@/services/ApiService';
import { usePopup } from '@/composables/usePopup';
import { Close, Edit, Delete, Refresh, MagicStick, QuestionFilled, List } from '@element-plus/icons-vue';
import dayjs from 'dayjs';
import LTooltip from '@/components/ui/LTooltip.vue';

const { confirm, toast } = usePopup();
const sessionStore = useSessionStore();

const emit = defineEmits<{
  close: [];
}>();

const props = defineProps<{
  sessionId: string | null;
}>();























































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































const summaries = ref<any[]>([]);
const summaryTotal = ref(0);
const showBreakdown = ref(false);
const editDialogVisible = ref(false);
const historyDialogVisible = ref(false);
const editingSummary = ref({ id: '', content: '' });
const sessionIdRef = computed(() => props.sessionId);
const { tokenStats, loading: loadingStats, fetchTokenStats } = useSessionTokenStats(sessionIdRef);

// 使用 Store 中的会话级压缩状态
const isCompressing = computed(() => {
  return props.sessionId ? sessionStore.sessionIsCompressing(props.sessionId) : false;
});

// 计算进度条颜色
const progressColor = computed(() => {
  if (!tokenStats.value) return '#409eff';
  const percentage = tokenStats.value.percentage;
  if (percentage < 60) return '#67c23a'; // 绿色
  if (percentage < 80) return '#e6a23c'; // 黄色
  return '#f56c6c'; // 红色
});

// 计算使用率颜色类
const usageColorClass = computed(() => {
  if (!tokenStats.value) return 'text-gray-700';
  const percentage = tokenStats.value.percentage;
  if (percentage < 60) return 'text-green-600';
  if (percentage < 80) return 'text-yellow-600';
  return 'text-red-600';
});

// 细分统计项（系统提示词/摘要/用户提示/历史/工具定义）
const breakdownItems = computed(() => {
  if (!tokenStats.value?.breakdown) return [];
  const total = tokenStats.value.totalTokens;
  const b = tokenStats.value.breakdown;
  const items = [
    { key: 'systemPrompt', label: '系统提示词', tokens: b.systemPrompt },
    { key: 'summary', label: '摘要', tokens: b.summary },
    { key: 'userPrompt', label: '用户提示', tokens: b.userPrompt },
    { key: 'history', label: '历史', tokens: b.history },
    { key: 'tools', label: '工具定义', tokens: b.tools },
  ];
  return items.map((item) => {
    const pct = total > 0 ? parseFloat(((item.tokens / total) * 100).toFixed(1)) : 0;
    const intense = pct >= 50;
    const moderate = pct >= 20;
    const colorClass = intense ? 'text-red-600 dark:text-red-500' : moderate ? 'text-yellow-600 dark:text-yellow-500' : 'text-green-600 dark:text-green-500';
    const barClass = intense ? 'bg-red-500' : moderate ? 'bg-yellow-500' : 'bg-green-500';
    return { ...item, percentage: pct, colorClass, barClass };
  });
});






























































// 加载摘要列表
async function loadSummaries() {
  if (!props.sessionId) return;
  try {
    const res = await apiService.fetchSessionSummaries(props.sessionId, 10);
    summaries.value = res.items;
    summaryTotal.value = res.total;
  } catch (error: any) {
    console.error('加载摘要失败:', error);
    toast.error('加载摘要失败');
  }
}

// 加载 Token 统计（委托到共享 composable）
async function loadTokenStats() {
  await fetchTokenStats();
}

// 编辑摘要
function handleEdit(summary: any) {
  editingSummary.value = {
    id: summary.id,
    content: summary.summaryContent,
  };
  editDialogVisible.value = true;
}

// 保存编辑
async function saveEdit() {
  try {
    await apiService.updateSummary(editingSummary.value.id, {
      summaryContent: editingSummary.value.content,
    });
    toast.success('摘要更新成功');
    editDialogVisible.value = false;
    await loadSummaries();
  } catch (error: any) {
    console.error('更新摘要失败:', error);
    toast.error('更新摘要失败');
  }
}

// 删除摘要
async function handleDelete(summary: any) {
  if (!(await confirm('确认删除', '确定要删除这条记忆摘要吗？此操作不可撤销。'))) {
    return;
  }

  try {
    await apiService.deleteSummary(summary.id);
    toast.success('摘要删除成功');
    await loadSummaries();
    // 删除摘要后，上下文窗口会释放空间，需要同步刷新 Token 统计
    await loadTokenStats();
  } catch (error: any) {
    console.error('删除摘要失败:', error);
    toast.error('删除摘要失败');
  }
}

// 格式化时间
function formatTime(dateString: string) {
  return dayjs(dateString).format('YYYY-MM-DD HH:mm:ss');
}

// 格式化数字（添加千位分隔符）
function formatNumber(num: number) {
  return num.toLocaleString();
}

// 获取策略标签类型
function getStrategyTagType(strategy: string) {
  const typeMap: Record<string, 'success' | 'warning' | 'info'> = {
    'pruned_only': 'warning',
    'summarized': 'success',
  };
  return typeMap[strategy] || 'info';
}

// 获取策略显示名称
function getStrategyLabel(strategy: string) {
  const labelMap: Record<string, string> = {
    'pruned_only': '仅裁剪',
    'summarized': '摘要压缩',
  };
  return labelMap[strategy] || strategy;
}

// 监听会话 ID 变化
watch(
  () => props.sessionId,
  (newSessionId) => {
    if (newSessionId) {
      
























































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































































      loadSummaries();
      loadTokenStats();
    } else {
      summaries.value = [];
      summaryTotal.value = 0;
      tokenStats.value = null;
    }
  },
  { immediate: true }
);

// 流状态变化自动刷新由 useSessionTokenStats 处理，这里只刷新摘要
watch(
  () => props.sessionId ? sessionStore.sessionIsStreaming(props.sessionId) : false,
  (isStreaming, wasStreaming) => {
    if (wasStreaming && !isStreaming) {
      loadSummaries();
    }
  }
);

// 处理压缩历史（弹出确认框）
async function handleCompress() {
  if (!props.sessionId) return;

  // 检查会话是否正在流式输出，避免干扰工作流程
  if (sessionStore.sessionIsStreaming(props.sessionId)) {
    toast.warning('当前会话正在流式输出，请等待结束后再压缩');
    return;
  }

  if (!(await confirm('确认压缩', '确定要压缩当前会话的历史记录吗？此操作将根据会话和角色的配置自动执行压缩。'))) {
    return;
  }

  try {
    sessionStore.setSessionIsCompressing(props.sessionId, true);
    const res = await apiService.compressSession(props.sessionId);

    if (res.success) {
      toast.success(`压缩成功！压缩比例: ${res.after?.compressionRatio || 'N/A'}`);
      // 压缩后重新加载统计数据和摘要列表
      await loadTokenStats();
      await loadSummaries();
    } else {
      toast.warning(res.message || "压缩未执行");
    }
  } catch (error: any) {
    console.error('压缩失败:', error);
    // 处理 409 冲突错误（会话正在流式输出或繁忙）
    if (error.status === 409 || error.message?.includes('busy') || error.message?.includes('STREAMING')) {
      toast.warning('当前会话正在流式输出，请等待结束后再压缩。');
    } else {
      toast.error(error.message || '压缩失败');
    }
  } finally {
    sessionStore.setSessionIsCompressing(props.sessionId, false);
  }
}

// 查看压缩历史
function handleViewHistory() {
  historyDialogVisible.value = true;
}

// 从历史记录中编辑摘要
function handleEditFromHistory(summary: any) {
  editingSummary.value = {
    id: summary.id,
    content: summary.summaryContent,
  };
  editDialogVisible.value = true;
}

// 从历史记录中删除摘要
async function handleDeleteFromHistory(summary: any) {
  if (!(await confirm('确认删除', '确定要删除这条记忆摘要吗？此操作不可撤销。'))) {
    return;
  }

  try {
    await apiService.deleteSummary(summary.id);
    toast.success('摘要删除成功');
    await loadSummaries();
    // 删除摘要后，上下文窗口会释放空间，需要同步刷新 Token 统计
    await loadTokenStats();
  } catch (error: any) {
    console.error('删除摘要失败:', error);
    toast.error('删除摘要失败');
  }
}

// 监听标签页切换逻辑已移除，因为不再使用 Tab 组件
// 监听会话 ID 变化时已经完成了数据加载
</script>

<style scoped>
/* 暗色模式下的 el-tag 样式优化 */
:deep(.el-tag) {
  --el-tag-bg-color: var(--el-color-warning-light-9);
  --el-tag-border-color: var(--el-color-warning-light-8);
  --el-tag-text-color: var(--el-color-warning-dark-2);
}

.dark :deep(.el-tag--success) {
  --el-tag-bg-color: rgba(103, 194, 58, 0.1);
  --el-tag-border-color: rgba(103, 194, 58, 0.2);
  --el-tag-text-color: #85ce61;
}

.dark :deep(.el-tag--warning) {
  --el-tag-bg-color: rgba(230, 162, 60, 0.1);
  --el-tag-border-color: rgba(230, 162, 60, 0.2);
  --el-tag-text-color: #ebb563;
}

/* 暗色模式下的按钮样式优化 */
.dark :deep(.el-button--small.is-text) {
  color: var(--el-text-color-regular);
}

.dark :deep(.el-button--small.is-text:hover) {
  background-color: var(--el-fill-color-light);
}

/* 暗色模式下的进度条颜色优化 */
.dark :deep(.el-progress-bar__inner) {
  transition: all 0.3s ease;
}
</style>
