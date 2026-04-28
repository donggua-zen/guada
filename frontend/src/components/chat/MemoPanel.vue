<template>
  <div class="h-full flex flex-col bg-white">
    <!-- 头部 -->
    <div class="flex items-center justify-between px-4 h-15 border-b border-gray-200">
      <h3 class="text-base font-semibold text-gray-800">记忆管理</h3>
      <el-button text @click="$emit('close')" class="hover:bg-gray-100">
        <el-icon>
          <Close />
        </el-icon>
      </el-button>
    </div>

    <!-- 内容区域 -->
    <div class="flex-1 flex flex-col px-4 overflow-y-auto pb-4">
      <!-- Token 统计部分 -->
      <template v-if="tokenStats">
        <!-- 使用率进度条 -->
        <div class="mb-6 pt-4">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-gray-700">上下文使用率</span>
            <span class="text-sm font-semibold" :class="usageColorClass">
              {{ tokenStats.percentage }}%
            </span>
          </div>
          <el-progress :percentage="tokenStats.percentage" :color="progressColor" :stroke-width="20"
            :show-text="false" />
        </div>

        <!-- 详细统计卡片 -->
        <div class="grid grid-cols-3 gap-4 mb-8">
          <div class="text-center">
            <div class="text-xs text-gray-500 mb-1">已用 Tokens</div>
            <div class="text-lg font-semibold text-gray-800">
              {{ tokenStats.usedTokens.toLocaleString() }}
            </div>
          </div>

          <div class="text-center border-l border-r border-gray-100">
            <div class="text-xs text-gray-500 mb-1">对话数量</div>
            <div class="text-lg font-semibold text-gray-800">
              {{ tokenStats.messageCount }}
            </div>
          </div>
          
          <div class="text-center">
            <div class="text-xs text-gray-500 mb-1">总容量</div>
            <div class="text-lg font-semibold text-gray-800">
              {{ tokenStats.totalTokens.toLocaleString() }}
            </div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="flex gap-2 mb-8">
          <el-button @click="loadTokenStats" :loading="loadingStats" class="flex-1">
            <el-icon class="mr-1">
              <Refresh />
            </el-icon>
            刷新
          </el-button>
          <el-button @click="handleCompress" :loading="isCompressing" class="flex-1">
            <el-icon class="mr-1">
              <MagicStick />
            </el-icon>
            {{ isCompressing ? '压缩中...' : '压缩' }}
          </el-button>
        </div>
      </template>
      <template v-else>
        <el-empty description="加载中..." :image-size="80" class="mb-8" />
      </template>

      <!-- 记忆摘要部分 -->
      <div class="border-t border-gray-100 pt-6">
        <div class="flex items-center justify-between mb-4">
          <h4 class="text-sm font-semibold text-gray-700">历史记忆摘要</h4>
          <span class="text-xs text-gray-400">共 {{ summaries.length }} 条</span>
        </div>
        
        <template v-if="summaries.length > 0">
          <div v-for="(summary, index) in summaries" :key="summary.id" class="mb-4">
            <div class="bg-gray-50 rounded-lg p-3 border border-gray-200 hover:border-blue-300 transition-colors">
              <!-- 摘要头部信息 -->
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-gray-500">#{{ summaries.length - index }}</span>
                <div class="flex gap-1">
                  <el-button size="small" text @click="handleEdit(summary)">
                    <el-icon>
                      <Edit />
                    </el-icon>
                  </el-button>
                  <el-button size="small" text @click="handleDelete(summary)"
                    class="text-red-500 hover:text-red-600">
                    <el-icon>
                      <Delete />
                    </el-icon>
                  </el-button>
                </div>
              </div>

              <!-- 摘要内容 -->
              <div class="text-sm text-gray-700 whitespace-pre-wrap">
                {{ summary.summaryContent }}
              </div>

              <!-- 时间戳 -->
              <div class="mt-2 text-xs text-gray-400">
                {{ formatTime(summary.createdAt) }}
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <el-empty description="暂无记忆摘要" :image-size="60" />
        </template>
      </div>
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

    <!-- 压缩历史配置弹窗 -->
    <el-dialog v-model="compressDialogVisible" title="压缩历史记录" width="450px" append-to-body>
      <div class="space-y-4">
        <p class="text-sm text-gray-600">压缩历史记录可以节省上下文长度并提高响应速度。</p>
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium w-28 text-right">压缩比例 (%)</label>
          <el-input-number v-model="compressionRatio" :min="10" :max="90" :step="5" controls-position="right"
            style="width: 100%" />
        </div>
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium w-28 text-right">保留最近轮数</label>
          <el-input-number v-model="minRetainedTurns" :min="1" :max="10" :step="1" controls-position="right"
            style="width: 100%" />
        </div>
        <div class="flex items-center gap-4">
          <label class="text-sm font-medium w-28 text-right">清理策略</label>
          <el-select v-model="cleaningStrategy" placeholder="请选择" style="width: 100%">
            <el-option label="激进 (仅保留引用)" value="aggressive" />
            <el-option label="中等 (智能精简)" value="moderate" />
            <el-option label="保守 (最小化处理)" value="conservative" />
          </el-select>
        </div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="compressDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="executeCompression">开始压缩</el-button>
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
import { Close, Edit, Delete, Refresh, MagicStick } from '@element-plus/icons-vue';
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

// 压缩配置
const compressionRatio = ref(50);
const minRetainedTurns = ref(3);
const cleaningStrategy = ref("moderate");
const compressDialogVisible = ref(false);

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

// 处理压缩历史（打开配置弹窗）
function handleCompress() {
  if (!props.sessionId) return;
  compressDialogVisible.value = true;
}

// 执行压缩
async function executeCompression() {
  if (!props.sessionId) return;

  try {
    compressDialogVisible.value = false;
    sessionStore.setSessionIsCompressing(props.sessionId, true);
    const res = await apiService.compressSessionHistory(
      props.sessionId, 
      compressionRatio.value, 
      minRetainedTurns.value,
      cleaningStrategy.value
    );
    
    if (res.success) {
      toast.success(`成功压缩 ${res.compressedTokens || 0} Tokens`);
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

// 监听标签页切换逻辑已移除，因为不再使用 Tab 组件
// 监听会话 ID 变化时已经完成了数据加载
</script>

<style scoped></style>
