<template>
    <el-dialog v-model="showTokenModal" title="Tokens估算(不含图片)" width="500px" :show-close="true">
        <div class="token-statistics">
            <!-- 统计条 -->
            <div class="mb-6">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-sm font-medium text-gray-700">Tokens使用情况</span>
                    <span class="text-sm text-gray-500">{{ usedTokens }} / {{ maxTokens }}</span>
                </div>
                <div class="w-full h-4 bg-gray-200 rounded-full overflow-hidden relative">
                    <!-- 提示词部分 -->
                    <div class="h-full bg-blue-500 absolute top-0 left-0 transition-all duration-300"
                        :style="{ width: `${(promptTokens / maxTokens) * 100}%` }"
                        :title="`提示词: ${promptTokens} tokens`"></div>
                    <!-- 摘要部分 -->
                    <div class="h-full bg-green-500 absolute top-0 transition-all duration-300" :style="{
                        width: `${(summaryTokens / maxTokens) * 100}%`,
                        left: `${(promptTokens / maxTokens) * 100}%`
                    }" :title="`摘要: ${summaryTokens} tokens`"></div>
                    <!-- 上下文部分 -->
                    <div class="h-full bg-yellow-500 absolute top-0 transition-all duration-300" :style="{
                        width: `${(contextTokens / maxTokens) * 100}%`,
                        left: `${((promptTokens + summaryTokens) / maxTokens) * 100}%`
                    }" :title="`上下文: ${contextTokens} tokens`"></div>
                </div>

                <!-- 图例 -->
                <div class="flex justify-between mt-3 text-xs">
                    <div class="flex items-center">
                        <div class="w-3 h-3 bg-blue-500 rounded mr-1"></div>
                        <span class="text-gray-600">提示词</span>
                    </div>
                    <div class="flex items-center">
                        <div class="w-3 h-3 bg-green-500 rounded mr-1"></div>
                        <span class="text-gray-600">摘要</span>
                    </div>
                    <div class="flex items-center">
                        <div class="w-3 h-3 bg-yellow-500 rounded mr-1"></div>
                        <span class="text-gray-600">上下文</span>
                    </div>
                    <div class="flex items-center">
                        <div class="w-3 h-3 bg-gray-200 rounded mr-1"></div>
                        <span class="text-gray-600">剩余</span>
                    </div>
                </div>
            </div>

            <!-- 详细数据 -->
            <div class="grid grid-cols-2 gap-4 text-sm">
                <div class="space-y-2">
                    <div class="flex justify-between">
                        <span class="text-gray-600">最大Tokens:</span>
                        <span class="font-medium">{{ maxTokens }}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">已使用:</span>
                        <span class="font-medium">{{ usedTokens }}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">剩余:</span>
                        <span class="font-medium">{{ maxTokens - usedTokens }}</span>
                    </div>
                </div>
                <div class="space-y-2">
                    <div class="flex justify-between">
                        <span class="text-blue-600">提示词:</span>
                        <span class="font-medium">{{ promptTokens }}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-green-600">摘要:</span>
                        <span class="font-medium">{{ summaryTokens }}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-yellow-600">上下文:</span>
                        <span class="font-medium">{{ contextTokens }}</span>
                    </div>
                </div>
            </div>
        </div>
        <template #footer>
            <span class="dialog-footer">
                <el-button @click="showTokenModal = false">确认</el-button>
            </span>
        </template>
    </el-dialog>
</template>
<script setup lang="ts">
import { ref, computed, watch } from "vue";
// @ts-ignore - Element Plus 尚未完全迁移到 TypeScript
import { ElDialog, ElButton } from "element-plus";
// @ts-ignore - ApiService 尚未迁移到 TypeScript
import { apiService } from "@/services/ApiService";

// Token 统计数据接口
interface TokenStatistics {
    maxTokens: number;
    promptTokens: number;
    summaryTokens: number;
    contextTokens: number;
}

const tokenStatistics = ref<TokenStatistics>({
    maxTokens: 0,
    promptTokens: 0,
    summaryTokens: 0,
    contextTokens: 0
});

// Props 类型化
const props = defineProps<{
    currentSessionId?: string;
    show?: boolean;
}>();

// Emits 类型化
const emit = defineEmits<{
    'update:show': [value: boolean]
}>();

// 计算属性 - 双向绑定
const showTokenModal = computed({
    get(): boolean {
        return props.show ?? false;
    },
    set(value: boolean) {
        emit('update:show', value)
    }
})

// 计算属性 - 类型化
const maxTokens = computed((): number => tokenStatistics.value.maxTokens);
const promptTokens = computed((): number => tokenStatistics.value.promptTokens);
const summaryTokens = computed((): number => tokenStatistics.value.summaryTokens);
const contextTokens = computed((): number => tokenStatistics.value.contextTokens);
const usedTokens = computed((): number =>
    promptTokens.value + summaryTokens.value + contextTokens.value
);


// 模拟获取 tokens 统计数据的接口 - 类型化
const fetchTokenStatistics = async (): Promise<TokenStatistics> => {
    // 模拟 API 调用延迟
    const response = await apiService.fetchTokenStatistics(props.currentSessionId || '');

    // 返回模拟数据
    return {
        maxTokens: response.max_memory_tokens,
        promptTokens: response.system_prompt_tokens,
        summaryTokens: response.summary_tokens,
        contextTokens: response.context_tokens,
    };
};

// 处理 tokens 统计 - 类型化
const handleTokensStatistic = async (): Promise<void> => {
    try {
        // 调用模拟接口获取数据
        const data = await fetchTokenStatistics();
        tokenStatistics.value = data;
    } catch (error: any) {
        console.error("获取 tokens 统计失败:", error);
        // notify.error("获取统计信息失败");
    }
};

// Watch 监听器 - 类型化
watch(() => props.show, async (newValue: boolean | undefined) => {
    if (newValue) {
        handleTokensStatistic();
    } else {
        tokenStatistics.value = {
            maxTokens: 0,
            promptTokens: 0,
            summaryTokens: 0,
            contextTokens: 0
        };
    }
}, { immediate: true });
</script>
<style scoped>
/* Tokens统计模态框样式 */
.token-statistics {
    padding: 16px 0;
}
</style>