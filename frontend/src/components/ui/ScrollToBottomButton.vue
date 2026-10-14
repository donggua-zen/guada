<!-- ScrollToBottomButton.vue：回到底部控件。
     中性小方块，与输入区上方状态行的 TODO 胶囊并排；由父级渲染为浮层（不占布局高度）。
     显隐只由 show 决定（未贴底即显示），与流式状态无关。 -->
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

// 只用 defineEmits 的 click：父级 @click 即事件监听器。
// （此前另把 onClick 声明为 prop 并手动再调一次，而 emit('click') 也会解析到同一个 props.onClick，
// 同一次点击会把父级处理器调用两遍。）
defineProps<{
    show?: boolean;
}>()

const emit = defineEmits<{
    click: [event: MouseEvent]
}>()

const { t } = useI18n()
const buttonRef = ref<HTMLButtonElement | null>(null)

function handleClick(event: MouseEvent): void {
    emit('click', event)
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
    /* 与运行时状态胶囊同圆角：同一行的两个 chip 必须同形（改这里要同步 ComposerStatusBar） */
    border-radius: 8px;
    background: var(--gd-color-surface);
    border: 1px solid var(--gd-color-border);
    color: var(--gd-color-text);
    cursor: pointer;
    padding: 0;
    outline: none;
    flex-shrink: 0;
    /* 悬停/按下色是半透明 tint（浅色主题 --gd-color-surface-hover = #2631480f，仅约 6% 不透明度，
       源自侧边栏行的极淡高亮），直接换 background 会把不透明的 surface 顶掉——本控件是浮层，
       底下的消息文字就会透出来。改用 inset 阴影叠在 surface 之上（阴影绘制在背景之上、内容之下）：
       合成结果恒为实色，且对主题的半透明/实色 tint 都自适应。
       静止态用同尺寸的全透明阴影，让过渡只发生在颜色上（不出现从边缘铺开的位移感）。 */
    box-shadow: inset 0 0 0 999px transparent;
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
}

.scroll-to-bottom-btn:hover,
.scroll-to-bottom-btn:active {
    box-shadow: inset 0 0 0 999px var(--gd-color-surface-hover);
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
