<template>
    <div v-html="debouncedFormattedText"></div>
</template>
<script setup>
import { watch, ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useMarkdown } from "../composables/useMarkdown";
import { useDebounceFn } from '@vueuse/core';

const { marked } = useMarkdown()
const emit = defineEmits(["render-complete"]);

const currentMarkdownContent = ref("");
const debouncedMarkdownUpdate = useDebounceFn(async (content) => {
    currentMarkdownContent.value = content;
    emit("render-complete");
}, 50, { maxWait: 150 });
// 处理流式内容更新的通用函数
const processStreamingContent = (content, oldContent, updateFunction) => {
    if (!content) {
        content = ""
    }
    updateFunction(content);
};

const debouncedFormattedText = computed(() => {
    if (!currentMarkdownContent.value) return "";
    try {
        return marked.parse(currentMarkdownContent.value.trim());
    } catch (error) {
        console.error("思考内容Markdown解析错误:", error);
        return currentMarkdownContent.value;
    }
});

const props = defineProps({
    content: {
        type: String,
        required: true
    },
    debounced: {
        type: Boolean,
        default: false
    },
});
watch(
    () => props.content,
    (newContent, oldContent) => {
        if (props.debounced) {
            processStreamingContent(newContent, oldContent, debouncedMarkdownUpdate);
        } else {
            currentMarkdownContent.value = newContent;
            emit("render-complete");
        }
    },
    { immediate: true }
);
</script>