<template>
    <Teleport to="body">
        <!-- 顶部居中堆叠容器：z 走 --gd-z-element（与原 ElMessage 4000 同值） -->
        <div class="gd-toast-host fixed left-1/2 top-4 z-(--gd-z-element) flex -translate-x-1/2 flex-col items-center gap-2 pointer-events-none">
            <TransitionGroup name="gd-toast">
                <!-- 出队即播 leave：service dismissToast 直接 splice，TransitionGroup 对被移除元素
                     自动播 gd-toast-leave-* 动画，transitionend 后移除 DOM。子元素不要用 v-show
                     （display:none 不参与 transition，leave 永远播不完） -->
                <div v-for="item in toastStack" :key="item.id" class="gd-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border border-white/40 dark:border-white/10 py-2.5 pl-3.5 pr-3 shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)] backdrop-blur-xl backdrop-saturate-150 bg-(--gd-color-surface)/90"
                    :data-type="item.type" role="status" :aria-live="item.type === 'error' ? 'assertive' : 'polite'">
                    <!-- 语义图标：loading 用 spinner，其余按类型配色 -->
                    <span v-if="item.type === 'loading'" class="gd-toast__icon flex shrink-0 items-center text-[var(--gd-color-primary)]">
                        <svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
                            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
                        </svg>
                    </span>
                    <span v-else class="gd-toast__icon flex shrink-0 items-center" :class="semanticIconClass[item.type]">
                        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path v-for="(d, i) in semanticIconPaths[item.type]" :key="i" :d="d" />
                        </svg>
                    </span>
                    <div class="min-w-0">
                        <div v-if="item.title" class="text-[13px] font-semibold leading-[18px] text-(--gd-color-text)">{{ item.title }}</div>
                        <div class="text-[13px] leading-[18px] text-(--gd-color-text) whitespace-pre-wrap break-words" :class="{ 'mt-0.5': item.title }">{{ item.content }}</div>
                    </div>
                    <button v-if="item.showClose" type="button" :tabindex="-1" aria-label="关闭"
                        class="ml-1 flex size-4 shrink-0 cursor-pointer items-center justify-center self-center border-0 bg-transparent p-0 text-[var(--gd-color-text-gray)] transition-colors duration-150 md:hover:text-[var(--gd-color-text)]"
                        @click="dismissToast(item.id)">
                        <svg class="size-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                    </button>
                </div>
            </TransitionGroup>
        </div>
    </Teleport>
</template>
<script setup lang="ts">
import { toastStack, dismissToast } from './toastService';
import { semanticIconClass, semanticIconPaths } from './semanticIcons';
</script>
<style scoped>
/* 进出场：从上方 8px 落下 / 收回，堆栈上移用 move 过渡 */
.gd-toast-enter-active,
.gd-toast-leave-active,
.gd-toast-move {
    transition: opacity var(--gd-motion-duration-base) var(--gd-motion-ease-toast),
        transform var(--gd-motion-duration-base) var(--gd-motion-ease-toast);
}

.gd-toast-enter-from,
.gd-toast-leave-to {
    opacity: 0;
    transform: translateY(-8px) scale(0.97);
}

.gd-toast-leave-active {
    /* leave 时脱离布局流，让下方条目平滑上移 */
    position: absolute;
    width: var(--gd-toast-width, auto);
}
</style>
