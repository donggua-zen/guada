<template>
  <div class="flex flex-col">
    <!-- Token 统计部分 -->
    <template v-if="tokenStats">
        <!-- 使用率进度条 -->
        <div class="mb-4 pt-2">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium text-gray-700 dark:text-[#e8e9ed]">上下文使用率</span>
              <el-tooltip content="上下文为估算值，仅供参考，与实际值可能存在差异" placement="top">
                <el-icon class="text-gray-400 dark:text-[#8b8d95] hover:text-gray-600 dark:hover:text-[#a8aab0] cursor-help transition-colors" :size="14">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </div>
            <span class="text-sm font-semibold" :class="usageColorClass">
              {{ tokenStats.percentage }}%
            </span>
          </div>
          <el-progress :percentage="tokenStats.percentage" :color="progressColor" :stroke-width="16"
            :show-text="false" />
        </div>

        <!-- 详细统计卡片 -->
        <div class="grid grid-cols-3 gap-2 mb-4">
          <div class="text-center">
            <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-0.5">已用</div>
            <div class="text-sm font-semibold text-gray-800 dark:text-[#e8e9ed]">
              {{ tokenStats.usedTokens.toLocaleString() }}
            </div>
          </div>

          <div class="text-center border-l border-r border-gray-100 dark:border-[#2a2c30]">
            <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-0.5">消息</div>
            <div class="text-sm font-semibold text-gray-800 dark:text-[#e8e9ed]">
              {{ tokenStats.messageCount }}
            </div>
          </div>
          
          <div class="text-center">
            <div class="text-xs text-gray-500 dark:text-[#8b8d95] mb-0.5">总量</div>
            <div class="text-sm font-semibold text-gray-800 dark:text-[#e8e9ed]">
              {{ tokenStats.totalTokens.toLocaleString() }}
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-2 mb-5">
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
      </template>
      <template v-else>
        <el-empty description="加载中..." :image-size="60" class="mb-5" />
      </template>

      <!-- 最新压缩状态 -->
      <div class="border-t border-gray-100 dark:border-[#2a2c30] pt-4">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">最新压缩状态</h4>
          <span class="text-xs text-gray-400 dark:text-[#8b8d95]">已压缩 {{ summaries.length }} 次</span>
        </div>
        
        <template v-if="summaries.length > 0">
          <!-- 只显示最新一条 -->
          <div :key="summaries[0].id" class="mb-2.5">
            <div class="rounded-lg py-2">
              <!-- 摘要内容或裁剪信息 -->
              <div v-if="summaries[0].summaryContent" class="text-xs text-gray-700 dark:text-[#c8c9cd] whitespace-pre-wrap leading-relaxed mb-2">
                {{ summaries[0].summaryContent }}
              </div>
              
              <!-- 统计信息区域：无论是否有摘要都显示 -->
              <div v-if="summaries[0].compressionStats || summaries[0].pruningMetadata" class="space-y-1.5 mb-2">
                <!-- 显示总体统计 -->
                <div class="bg-white dark:bg-[#232428] rounded p-2 border border-gray-100 dark:border-[#2a2c30] space-y-1.5">
                  <div v-if="summaries[0].compressionStats?.beforeTokenCount && summaries[0].compressionStats?.afterTokenCount" class="flex justify-between items-center text-xs">
                    <span class="text-gray-600 dark:text-[#a8aab0]">Token:</span>
                    <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                      {{ formatNumber(summaries[0].compressionStats.beforeTokenCount) }} → {{ formatNumber(summaries[0].compressionStats.afterTokenCount) }}
                      <span class="text-green-600 dark:text-green-500 ml-1">(-{{ formatNumber(summaries[0].compressionStats.beforeTokenCount - summaries[0].compressionStats.afterTokenCount) }})</span>
                    </span>
                  </div>
                  <div v-if="summaries[0].compressionStats?.beforeMessageCount && summaries[0].compressionStats?.afterMessageCount" class="flex justify-between items-center text-xs">
                    <span class="text-gray-600 dark:text-[#a8aab0]">消息:</span>
                    <span class="font-medium text-gray-800 dark:text-[#e8e9ed]">
                      {{ summaries[0].compressionStats.beforeMessageCount }} → {{ summaries[0].compressionStats.afterMessageCount }}
                    </span>
                  </div>
                  <div v-if="summaries[0].pruningMetadata" class="flex items-center gap-1.5 text-xs pt-1">
                    <el-tag size="small" type="warning">仅裁剪</el-tag>
                    <span class="text-gray-500 dark:text-[#8b8d95]">{{ Object.keys(summaries[0].pruningMetadata).length }} 条</span>
                  </div>
                  <div v-else-if="summaries[0].summaryContent" class="flex items-center gap-1.5 text-xs pt-1">
                    <el-tag size="small" type="success">摘要压缩</el-tag>
                  </div>
                </div>
              </div>
              
              <div v-else class="text-xs text-gray-400 dark:text-[#8b8d95] italic mb-2">
                无摘要内容
              </div>

              <!-- 底部信息：时间戳和操作按钮 -->
              <div class="flex items-center justify-between text-xs">
                <span class="text-gray-400 dark:text-[#8b8d95] truncate" :title="formatTime(summaries[0].createdAt)">{{ formatTime(summaries[0].createdAt) }}</span>
                <div class="flex gap-1">
                  <el-button 
                    size="small" 
                    text 
                    @click="handleViewHistory"
                    class="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  >
                    <el-icon><List /></el-icon>
                    <span class="ml-1">历史</span>
                  </el-button>
                  <el-button 
                    size="small" 
                    text 
                    @click="handleEdit(summaries[0])"
                    class="text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  >
                    <el-icon><Edit /></el-icon>
                    <span class="ml-1">编辑</span>
                  </el-button>
                  <el-button 
                    size="small" 
                    text 
                    @click="handleDelete(summaries[0])"
                    class="text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <el-icon><Delete /></el-icon>
                    <span class="ml-1">删除</span>
                  </el-button>
                </div>
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
    <el-dialog v-model="historyDialogVisible" title="压缩历史记录" width="800px" append-to-body>
      <div class="max-h-[600px] overflow-y-auto">
        <template v-if="summaries.length > 0">
          <div v-for="(summary, index) in summaries" :key="summary.id" class="mb-4 last:mb-0">
            <div class="rounded-lg border border-gray-200 dark:border-[#2a2c30] bg-white dark:bg-[#232428] p-4">
              <!-- 头部：序号和时间 -->
              <div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-100 dark:border-[#2a2c30]">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-gray-700 dark:text-[#e8e9ed]">第 {{ summaries.length - index }} 次压缩</span>
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

                  <!-- 仅裁剪标记 -->
                  <div v-if="summary.pruningMetadata" class="flex items-center gap-2 text-xs pt-1">
                    <el-tag size="small" type="warning">仅裁剪模式</el-tag>
                    <span class="text-gray-500 dark:text-[#8b8d95]">裁剪了 {{ Object.keys(summary.pruningMetadata).length }} 条消息</span>
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
      </div>
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
import { useDebounceFn } from '@vueuse/core';
import { useSessionStore } from '@/stores/session';
import { apiService } from '@/services/ApiService';
import { usePopup } from '@/composables/usePopup';
import { Close, Edit, Delete, Refresh, MagicStick, QuestionFilled, List } from '@element-plus/icons-vue';
import dayjs from 'dayjs';

const { confirm, toast } = usePopup();
const sessionStore = useSessionStore();

const emit = defineEmits<{
  close: [];
}>();

const props = defineProps<{
  sessionId: string | null;
}>();

const summaries = ref<any[]>([]);
const editDialogVisible = ref(false);
const historyDialogVisible = ref(false);
const editingSummary = ref({ id: '', content: '' });
const tokenStats = ref<{
  usedTokens: number
  totalTokens: number
  remainingTokens: number
  percentage: number
  modelName: string
  messageCount: number
} | null>(null);
const loadingStats = ref(false);

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

// 加载摘要列表
async function loadSummaries() {
  if (!props.sessionId) return;
  try {
    summaries.value = await apiService.fetchSessionSummaries(props.sessionId);
  } catch (error: any) {
    console.error('加载摘要失败:', error);
    toast.error('加载摘要失败');
  }
}

// 加载 Token 统计
async function loadTokenStats() {
  if (!props.sessionId) return;
  loadingStats.value = true;
  try {
    tokenStats.value = await apiService.fetchSessionTokenStats(props.sessionId);
  } catch (error: any) {
    console.error('加载 Token 统计失败:', error);
    toast.error('加载 Token 统计失败');
  } finally {
    loadingStats.value = false;
  }
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
      tokenStats.value = null;
    }
  },
  { immediate: true }
);

// 监听流状态变化，实现对话完成后的自动刷新
const debouncedRefresh = useDebounceFn(() => {
  if (!props.sessionId || !sessionStore.activeSessionId) return;
  
  loadTokenStats();
  loadSummaries();
}, 1000); // 1秒防抖

watch(
  () => props.sessionId ? sessionStore.sessionIsStreaming(props.sessionId) : false,
  (isStreaming, wasStreaming) => {
    // 当状态从 true 变为 false 时（对话结束）
    if (wasStreaming && !isStreaming) {
      debouncedRefresh();
    }
  }
);

// 处理压缩历史（弹出确认框）
async function handleCompress() {
  if (!props.sessionId) return;
  
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
    // 处理 409 冲突错误（会话繁忙）
    if (error.status === 409 || error.message?.includes('busy')) {
      toast.warning('当前会话正在处理其他任务（如对话或压缩），请稍后再试。');
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
