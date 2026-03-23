<template>
    <!-- 优化后的思考框部分 -->
    <div v-if="turn.reasoning_content" class="thinking-section" :class="{ 'thinking-expanded': isExpanded }">
        <div class="inline-flex justify-between items-center text-sm text-gray-700 cursor-pointer font-medium py-1 transition-colors duration-200 mb-1"
            @click="toggleExpand">
            <div class="flex items-center inline-flex">
                <span class="text-gray-500">{{ thinkingLabel }}</span>
            </div>
            <el-icon :class="['transition-transform duration-300 ml-2', isExpanded ? 'rotate-90' : 'rotate-0']"
                size="10">
                <ArrowRightTwotone />
            </el-icon>
        </div>
        <div class="thinking-container" :class="{ expanded: isExpanded }">
            <MarkdownContent @click="handleClick"
                class="thinking-content markdown-text py-0 border-l-2 pl-4 border-gray-200 dark:border-gray-700 mb-2 text-gray-500 dark:text-gray-400"
                :content="turn.reasoning_content" />
        </div>
    </div>

    <MarkdownContent v-if="turn.content" class="message-text markdown-text" @click="handleClick"
        v-html2="debouncedFormattedText" :content="turn.content" />
</template>
<script setup>
import { watch, ref, computed, onMounted, onBeforeUnmount } from 'vue';

const isExpanded = ref(false);

const toggleExpand = () => {
    isExpanded.value = !isExpanded.value;
};
const thinkingLabel = computed(() => {
    return props.turn.state.is_thinking ? "思考中..." : "已深度思考"
});
const props = defineProps({
    turn: {
        type: Object,
        required: true
    },
});

</script>