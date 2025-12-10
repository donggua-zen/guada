<template>
    <n-modal v-model:show="showTokenModal" preset="dialog" title="Tokens估算(不含图片)" positive-text="确认" :show-icon="false"
        style="width: 500px">
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
    </n-modal>
</template>
<script setup>
import { ref, computed, watch, defineEmits } from "vue";
import { NModal } from "naive-ui";
import { apiService } from "@/services/ApiService";

const tokenStatistics = ref({
    maxTokens: 0,
    promptTokens: 0,
    summaryTokens: 0,
    contextTokens: 0
});

const props = defineProps({
    currentSessionId: String,
    show: {
        type: Boolean,
        default: false
    },
});

const showTokenModal = computed({
    get() {
        return props.show;
    },
    set(value) {
        emit('update:show', value)
    }
})

// 计算属性
const maxTokens = computed(() => tokenStatistics.value.maxTokens);
const promptTokens = computed(() => tokenStatistics.value.promptTokens);
const summaryTokens = computed(() => tokenStatistics.value.summaryTokens);
const contextTokens = computed(() => tokenStatistics.value.contextTokens);
const usedTokens = computed(() =>
    promptTokens.value + summaryTokens.value + contextTokens.value
);

const emit = defineEmits(["update:show"]);


// 模拟获取tokens统计数据的接口
const fetchTokenStatistics = async () => {
    // 模拟API调用延迟
    const response = await apiService.fetchTokenStatistics(props.currentSessionId);

    // 返回模拟数据
    return {
        maxTokens: response.max_memory_tokens,
        promptTokens: response.system_prompt_tokens,
        summaryTokens: response.summary_tokens,
        contextTokens: response.context_tokens,
    };
};

// 处理tokens统计
const handleTokensStatistic = async () => {
    try {
        // 调用模拟接口获取数据
        const data = await fetchTokenStatistics();
        tokenStatistics.value = data;
    } catch (error) {
        console.error("获取tokens统计失败:", error);
        // notify.error("获取统计信息失败");
    }
};
watch(() => showTokenModal, async (newValue) => {
    if (newValue.value) {
        handleTokensStatistic();
    } else {
        tokenStatistics.value = {
            maxTokens: 0,
            promptTokens: 0,
            summaryTokens: 0,
            contextTokens: 0
        };
    }
}, { immediate: true, deep: true });
</script>
<style scoped>
/* Tokens统计模态框样式 */
.token-statistics {
    padding: 16px 0;
}
</style>