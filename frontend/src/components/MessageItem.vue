<template>
  <div class="message" :class="messageClass">
    <div class="avatar" :class="avatarClass">
      <i v-if="!isAssistant || !character.avatar_url" :class="avatarIcon"></i>
    </div>

    <div class="message-content">
      <div class="message-card">
        <div v-if="showThinking" class="thinking-section" :class="{ 'thinking-expanded': isExpanded }">
          <div class="thinking-header" @click="toggleExpand">
            <i class="fas fa-lightbulb"></i>
            <span>{{ thinkingLabel }}</span>
            <i class="fas" :class="expandIcon"></i>
          </div>
          <div class="thinking-content markdown-text" v-html="formattedReasoning"></div>
        </div>

        <div class="message-text markdown-text" v-html="formattedContent"></div>
        <div v-if="message.meta_data && message.meta_data.finish_reason == 'error'" class="response-error">
          <div class="response-error-title">API请求错误</div>
          <div class="response-error-content">{{ message.meta_data.error }}</div>
        </div>
        <div v-if="message.is_streaming" class="assistant-loading">
          回答中...
        </div>
      </div>

      <div class="message-actions">
        <div v-for="action in availableActions" :key="action.name" class="message-action"
          @click="handleAction(action.name)">
          <i :class="action.icon" alt="{{ action.text }}"></i>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { marked } from "marked";

const props = defineProps({
  message: Object,
  character: Object,
  isLast: {
    type: Boolean,
    default: false
  }
});

const isExpanded = ref(false);
const isThinking = ref(false);
const isAssistant = computed(() => props.message.role === "assistant");
const messageClass = computed(() =>
  isAssistant.value ? "assistant-message-container" : "user-message-container"
);
const avatarClass = computed(() =>
  isAssistant.value ? "assistant-avatar" : "user-avatar"
);
const avatarIcon = computed(() =>
  isAssistant.value ? "fas fa-robot" : "fas fa-user"
);

const showThinking = computed(
  () => isAssistant.value && props.message.reasoning_content
);

const thinkingLabel = ref("已深度思考");


const expandIcon = computed(() =>
  isExpanded.value ? "fa-angle-down" : "fa-angle-right"
);

const formattedText = ((text) => {
  return text;
  // if (!props.isGenerating) {
  //   return text;
  // }

  // // 使用 Array.from 正确分割 Unicode 字符（包括 emoji）
  // const textArray = Array.from(text);
  // const loadingLen = textArray.length > 5 ? 5 : textArray.length;

  // // 获取前部分文本（除了最后几个字符）
  // const text_loaded = textArray.slice(0, textArray.length - loadingLen).join('');

  // // 获取需要动画的最后几个字符
  // const text_animate = textArray.slice(-loadingLen);

  // let result = text_loaded;

  // for (let i = 0; i < text_animate.length; i++) {
  //   const char = text_animate[i];
  //   // 为每个字符添加动画延迟，确保 Unicode 字符完整
  //   result += `<span class='typewriter-char' style="animation-delay: ${i * 0.1}s">${char}</span>`;
  // }

  // return result;
})

const formattedContent = computed(() =>
  marked.parse(formattedText(props.message.content || "")).trim()
);

const formattedReasoning = computed(() =>
  marked.parse(formattedText(props.message.reasoning_content || "")).trim()
);

const availableActions = computed(() => {
  const baseActions = [
    { name: "delete", icon: "fas fa-trash", text: "删除" },
    { name: "edit", icon: "fas fa-edit", text: "编辑" },
    { name: "copy", icon: "fas fa-copy", text: "复制" },
  ];

  if (!isAssistant.value && props.isLast) {
    baseActions.unshift({
      name: "regenerate",
      icon: "fas fa-arrow-down",
      text: "重答",
    });
  }

  return baseActions;
});

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

const handleAction = (action) => {
  emit(action, props.message);
};

const startThinking = () => {
  console.log("startThinking called");
  isThinking.value = true;
  isExpanded.value = true;
  thinkingLabel.value = "正在思考...";
};

const stopThinking = () => {
  console.log("stopThinking called");
  isThinking.value = false;
  isExpanded.value = false;
  thinkingLabel.value = "已深度思考";
};

defineExpose({ startThinking, stopThinking });
const emit = defineEmits(["delete", "edit", "copy", "regenerate"]);
</script>

<style scoped>
/* 消息样式 */
.message {
  display: flex;
  gap: 15px;
  max-width: 100%;
  width: 800px;
  margin-top: 20px;
  margin-bottom: 25px;
  animation: fadeInUp 0.3s ease;
}

.avatar {
  width: 45px;
  height: 45px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 20px;
  color: white;
  align-self: flex-start;
  overflow: hidden;
}

.assistant-avatar img {
  display: block;
  width: 100%;
  height: 100%;
}

.user-avatar {
  background-color: var(--primary-color);
}

.assistant-avatar {
  background-color: #34c759;
}


/* 新增卡片式设计 */
.message-card {
  /* box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); */
  /* position: relative; */
  /* display: inline-block; */
  max-width: 670px;
  /* width: fit-content; */
  line-height: 1.5;
  font-size: 16px;
  letter-spacing: 1.3px;
  /* min-width: 200px; */
  /* 设置最小宽度防止卡片过窄 */
  /* min-height: 60px; */
  /* 设置最小高度防止卡片过扁 */
  transition: all 0.3s ease;
  /* 添加过渡动画 */
  /* min-width: 300px; */
}

/* 用户消息气泡特定样式 */
.user-message-container .message-card {
  margin-left: auto;
  /* background: linear-gradient(135deg, #4a90e2, #3a7bc8); */
  background-color: var(--primary-color);
  color: var(--primary-text-light-color);
  padding: 8px 12px;
  border-radius: 12px;
  /* border: 1px solid #eee; */
  /* width: 100%; */
}

/* AI消息气泡特定样式 */
.assistant-message-container .message-card {
  /* background: #ffffff; */
  background: var(--assitant-popup-bg);
  color: var(--primary-text-color);
  margin-right: auto;
  width: 100%;
  padding: 0;
  box-shadow: none;
  border: none;
}

.message-content {
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 修复用户消息对齐问题 */
.message.user-message-container {
  flex-direction: row-reverse;
  /* align-self: flex-end; */
}

.message.assistant-message-container {
  /* align-self: flex-start; */
  justify-content: flex-start;
}

.message.user-message-container .message-content {
  /* align-items: flex-end; */
  align-items: flex-start;
}

.message.assistant-message-container .message-content {
  align-items: flex-start;
  width: 100%;
}

/* 添加消息操作按钮的默认隐藏和悬停显示样式 */
.message-content .message-actions {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.3s ease,
    visibility 0.3s ease;
  margin-top: 8px;
}

.message-content:hover .message-actions {
  opacity: 1;
  visibility: visible;
}

.message-actions {
  display: flex;
  gap: 0;
  /* 从15px缩短到8px */
  font-size: 14px;
  width: 100%;
  justify-content: flex-end;
  margin-top: 15px;
}

.user-message-container .message-actions {
  justify-content: flex-end;
}

.assistant-message-container .message-actions {
  justify-content: flex-start;
}

/* 消息文本格式化 */
.message-text {
  line-height: 1.8;
  color: inherit;
  font-size: 16px;
  max-width: 100%;
  vertical-align: middle;
}


.message-action {
  color: #aaa;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.2s;
  padding: 4px 8px;
  border-radius: 4px;
}

.message-action:hover {
  color: #4a90e2;
  background-color: #f0f7ff;
}

.user-message-container .message-action:hover {
  color: #4a90e2;
  background-color: rgba(255, 255, 255, 0.2);
}

.ai-meta {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}

/* 思考部分样式 */
.thinking-section {
  /* background-color: #f8f9fa; */
  /* border-radius: 8px; */
  /* padding: 0 12px 0; */
  margin-bottom: 10px;
  transition: all 0.3s ease;
  overflow: hidden;
  /* border: 1px solid #e9ecef; */

}

.thinking-hide {
  display: none;
}

.thinking-content {
  font-size: 14px;
  color: var(--thinking-text-color);
  line-height: 1.8;
  /* white-space: pre-wrap; */
  margin-top: 0;
  padding-top: 0;
  border-top: none;
  opacity: 0;
  transition: all 0.3s ease;
  display: none;
  max-width: 100%;
  border-left: rgba(0, 0, 0, .08) 2px solid;
  padding: 0 15px;
}

.thinking-expanded .thinking-content {
  opacity: 1;
  margin-top: 12px;
  /* padding-top: 12px; */
  /* border-top: 1px solid #e9ecef; */
}

.thinking-header {
  /* display: flex; */
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  color: #495057;
  cursor: pointer;
  font-weight: 500;
}

.thinking-header:hover {
  /* background-color: #f1f3f5; */
}

.thinking-header i:first-child {
  font-size: 14px;
  color: #ffd43b;
  margin-right: 4px;
}

.thinking-header i:last-child {
  color: #6c757d;
  transition: transform 0.3s ease;
  font-size: 14px;
}

.thinking-expanded .thinking-header i:last-child {
  transform: rotate(0deg);
}

.thinking-header span {
  flex: 1;
  padding-left: 5px;
  color: #666666;
}

.toggle-thinking {
  background: none;
  border: none;
  color: #4a90e2;
  cursor: pointer;
  font-size: 14px;
}

.thinking-expanded .thinking-content {
  display: block;
}

/* 错误响应样式 */
.response-error {
  padding: 15px;
  border: 1px solid #ff4d4f;
  background-color: #fff2f0;
  border-radius: 4px;
  color: #f5222d;
  margin: 15px 0;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 2px 5px rgba(255, 77, 79, 0.1);
  border-radius: 12px;
}

.response-error-title {
  font-weight: bold;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.response-error-title::before {
  content: "⚠";
  font-size: 16px;
  margin-right: 8px;
}

.response-error-content {
  font-size: 15px;
  line-height: 1.5;
}

/* 加载动画 */
.assistant-loading {
  color: #999;
  font-size: 14px;
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.fa-spin {
  animation: fa-spin 1s infinite linear;
}
</style>
<style>
.markdown-text p {
  margin-top: 0;
  margin-bottom: 10px;
}

.markdown-text :last-child {
  margin: 0;
}

.markdown-text h1,
.markdown-text h2,
.markdown-text h3,
.markdown-text h4,
.markdown-text h5,
.markdown-text h6 {
  margin-top: 1.2em;
  margin-bottom: 0.8em;
  font-weight: 600;
  line-height: 1.4;
  color: inherit;
}

.markdown-text h1 {
  font-size: 1.4em;
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.5em;
}

.markdown-text h2 {
  font-size: 1.3em;
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.5em;
}

.markdown-text h3 {
  font-size: 1.2em;
}

.markdown-text h4 {
  font-size: 1.1em;
}

.markdown-text h5 {
  font-size: 1em;
}

.markdown-text h6 {
  font-size: 0.9em;
  color: #6a737d;
}

.markdown-text a {
  color: #0366d6;
  text-decoration: none;
}

.markdown-text a:hover {
  text-decoration: underline;
}

.markdown-text ul,
.markdown-text ol {
  padding-left: 2em;
  margin-bottom: 1em;
}

.markdown-text li {
  margin-bottom: 0.25em;
}

.markdown-text li>ul,
.markdown-text li>ol {
  margin-top: 0.25em;
}

.markdown-text code {
  background-color: #f6f8fa;
  border-radius: 3px;
  padding: 0.2em 0.4em;
  font-size: 0.9em;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

.markdown-text pre {
  background-color: #fff;
  border-radius: 5px;
  padding: 1em;
  overflow: auto;
  margin-top: 1rem;
  margin-bottom: 1em;
  border: 1px solid #dfe2e5;
}

.markdown-text pre code {
  background: none;
  padding: 0;
}

.markdown-text blockquote {
  border-left: 4px solid #dfe2e5;
  margin: 0 0 1em;
  padding-left: 1em;
}

.markdown-text table {
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 1em;
}

.markdown-text th,
.markdown-text td {
  border: 1px solid #dfe2e5;
  padding: 0.5em 1em;
}

.markdown-text th {
  background-color: #f6f8fa;
  font-weight: 600;
}

.markdown-text tr:nth-child(even) {
  background-color: #f6f8fa;
}

.markdown-text hr {
  height: 1px;
  background-color: #eaecef;
  border: none;
  margin: 1.5em 0;
}

.markdown-text img {
  max-width: 100%;
  height: auto;
  border-radius: 3px;
}

.markdown-text strong {
  font-weight: 600;
}

.markdown-text em {
  font-style: italic;
}
</style>
<style>
/* 打字机字符动画 */
/* .typewriter-char {
  display: inline-block;
  opacity: 0;
  animation: typewriter 0.4s ease-out forwards;
}

@keyframes typewriter {
  0% {
    opacity: 0;
    transform: translateY(5px) scale(0.8);
  }

  50% {
    opacity: 0.6;
    transform: translateY(0) scale(1.05);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
} */

/* 或者更简单的淡入效果 */
.typewriter-char {
  opacity: 0;
  animation: charFadeIn 0.2s ease-in forwards;
}

@keyframes charFadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>