<!-- ScrollToBottomButton.vue：回到底部控件。
     中性小方块，与输入区上方状态行的 TODO 胶囊并排（不再悬浮于消息区）。
     仅在未贴底（show）时淡入。 -->
<template>
    <Transition name="fade">
        <button v-if="show" ref="buttonRef" class="scroll-to-bottom-btn" type="button"
            :aria-label="t('chat.panel.scrollToBottom')" @click="handleClick">
            <svg class="scroll-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 9L12 15L18 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round" />
            </svg>
        </button>
    </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
    show?: boolean;
    isStreaming?: boolean;
    onClick?: (event: MouseEvent) => void;
}>()

const emit = defineEmits<{
    click: [event: MouseEvent]
}>()

const { t } = useI18n()
const buttonRef = ref<HTMLButtonElement | null>(null)

function handleClick(event: MouseEvent): void {
    emit('click', event)
    if (props.onClick) {
        props.onClick(event)
    }
}

defineExpose({
    buttonRef
})
</script>

<style scoped>
.scroll-to-bottom-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--gd-color-surface);
    border: 1px solid var(--gd-color-border);
    color: var(--gd-color-text);
    cursor: pointer;
    padding: 0;
    outline: none;
    flex-shrink: 0;
    transition: background 0.15s ease, border-color 0.15s ease;
}

.scroll-to-bottom-btn:hover {
    background: var(--gd-color-surface-hover);
}

.scroll-to-bottom-btn:active {
    background: var(--gd-color-surface-hover);
}

.scroll-icon {
    width: 16px;
    height: 16px;
}

/* 淡入淡出 */
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: translateY(6px);
}
</style>
