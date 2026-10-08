<template>
  <!-- 思考中状态行：3×3 点阵动画 + 轮播文案 + 可选耗时（对齐 Qoder 思考指示的动效参数） -->
  <span class="thinking-status">
    <span class="ts-icon" aria-hidden="true">
      <span class="ts-grid">
        <span v-for="(delay, i) in DOT_DELAYS" :key="i" class="ts-dot" :style="{ animationDelay: `${delay}s` }" />
      </span>
    </span>
    <Transition v-if="props.showText" name="ts-fade" mode="out-in">
      <span :key="displayText" class="ts-text">{{ displayText }}</span>
    </Transition>
    <span v-if="props.durationText" class="ts-duration">· {{ props.durationText }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(defineProps<{
  /** 已格式化耗时（如 "12.3s"），空则不渲染 */
  durationText?: string | null;
  /** 文案轮播间隔（ms） */
  cycleInterval?: number;
  /** 是否显示轮播文案（侧边栏等窄场景只要点阵） */
  showText?: boolean;
}>(), {
  durationText: "",
  cycleInterval: 10000,
  showText: true,
});

const { t, tm } = useI18n();

/** 行优先错峰的 9 个点延迟（对齐 Qoder DOT_MATRIX_DELAYS） */
const DOT_DELAYS = [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84, 0.96];

/** 文案池（i18n 数组，按语言取）；取不到时回退到 chat.turn.working。
 *  tm 的泛型签名在此处会触发 TS2589（过深实例化），故收敛为宽松签名后再取。 */
const pool = computed<string[]>(() => {
  const list = (tm as (key: string) => unknown)("chat.turn.thinkingPool");
  return Array.isArray(list) ? (list as string[]) : [];
});

const index = ref(0);
const displayText = computed(() => pool.value[index.value] ?? t("chat.turn.working"));

let cycleTimer: number | null = null;

onMounted(() => {
  if (!props.showText) return;
  const len = pool.value.length;
  index.value = len > 0 ? Math.floor(Math.random() * len) : 0;
  if (len < 2) return;
  cycleTimer = window.setInterval(() => {
    // 随机跳且不与上一条重复：步长取 1..len-1
    const step = 1 + Math.floor(Math.random() * (len - 1));
    index.value = (index.value + step) % len;
  }, props.cycleInterval);
});

onUnmounted(() => {
  if (cycleTimer !== null) {
    clearInterval(cycleTimer);
    cycleTimer = null;
  }
});
</script>

<style scoped>
.thinking-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ts-icon {
  position: relative;
  display: block;
  flex-shrink: 0;
  /* 13px 盒 = 点阵自身尺寸：点阵满铺后不再需要居中变换 */
  width: 13px;
  height: 13px;
  overflow: hidden;
}

/* 3×3 点阵：3px 点 + 2px 间隙 → 3×3 + 2×2 = 13px，行列坐标全为整数。
   原为 12px 盒内 2.5px 点 + space-between（间隙 2.25px）+ translate(-50%,-50%)，
   全是小数：点会发虚，动画缩放中心也落在半像素上。 */
.ts-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(3, 3px);
  grid-template-rows: repeat(3, 3px);
  gap: 2px;
  line-height: 0;
}

.ts-dot {
  width: 3px;
  height: 3px;
  border-radius: 9999px;
  background: currentColor;
  opacity: 0.28;
  animation: ts-dot-matrix 1.4s ease-in-out infinite;
}

@keyframes ts-dot-matrix {
  0%,
  100% {
    opacity: 0.24;
    transform: scale(0.72);
  }
  36% {
    opacity: 1;
    transform: scale(1);
  }
  68% {
    opacity: 0.44;
    transform: scale(0.82);
  }
}

.ts-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ts-duration {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.ts-fade-enter-active,
.ts-fade-leave-active {
  transition: opacity 0.4s ease-in-out;
}
.ts-fade-enter-from,
.ts-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ts-dot {
    animation: none;
    opacity: 0.56;
    transform: none;
  }
  .ts-fade-enter-active,
  .ts-fade-leave-active {
    transition: none;
  }
}
</style>
