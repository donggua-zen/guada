<template>
  <!-- 子代理头像：参考项目 WorkflowAgentFace 同款——身份色圆角方块 + 两只药丸眼。
       状态用「形状 + 颜色」双通道表达，避免只靠粉/红区分：
       - 完成：左下角绿色勾选徽标
       - 失败：整张脸转危险色 + 左下角红色叉号徽标
       - 运行中：眼睛眨眼 + 左右看（仅 running 时挂动画）
       颜色由外层 .subagent-block 下发 --sa-identity-face；徽标描边跟随背景色。
       外框比同排 16px 线条图标小一圈：实心色块的视觉重量约为细线图标的两倍，
       等尺寸会显得偏大（viewBox 内缩，眼睛/徽标坐标保持不变）。 -->
  <svg class="sa-face" :class="{ 'is-failed': failed, 'is-running': running && !failed }"
    viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <rect class="sa-face__body" x="1.5" y="1.5" width="17" height="17" rx="6" />
    <!-- 两层嵌套：外层左右看，内层眨眼，两个动画互不覆盖 -->
    <g class="sa-face__look">
      <g class="sa-face__blink">
        <g class="sa-face__eyes">
          <rect x="7" y="6" width="4" height="6" rx="2" />
          <rect x="13" y="6" width="4" height="6" rx="2" />
        </g>
      </g>
    </g>
    <g v-if="done && !failed" class="sa-face__done">
      <circle cx="3" cy="17" r="5.5" stroke-width="1.5" />
      <path d="m0.5 17 1.7 1.7 3.3-3.4" stroke-width="1.5" />
    </g>
    <g v-else-if="failed" class="sa-face__failed">
      <circle cx="3" cy="17" r="5.5" stroke-width="1.5" />
      <path d="m0.9 14.9 4.2 4.2M5.1 14.9l-4.2 4.2" stroke-width="1.6" />
    </g>
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  /** 已完成：左下角叠绿色勾选徽标 */
  done?: boolean;
  /** 失败：脸转危险色，左下角叠红色叉号徽标 */
  failed?: boolean;
  /** 运行中：眼睛眨眼 + 左右看 */
  running?: boolean;
}>();
</script>

<style scoped>
.sa-face {
  width: 16px;
  height: 16px;
  min-width: 16px;
  /* 完成/失败徽标向左下溢出约 2px：留出安全边距，避免贴到消息流左缘被裁切 */
  margin-left: 2px;
  flex-shrink: 0;
  /* 徽标画在 20 格之外，不能被 svg 视口裁掉 */
  overflow: visible;
}

.sa-face__body {
  fill: var(--sa-identity-face);
}

.sa-face.is-failed .sa-face__body {
  fill: var(--gd-color-danger);
}

.sa-face__eyes {
  fill: #fff;
}

/* 眨眼：围绕双眼包围盒中心纵向压扁；fill-box 让 SVG 里的 transform-origin 可控 */
.sa-face__look,
.sa-face__blink {
  transform-box: fill-box;
  transform-origin: center;
}

.sa-face.is-running .sa-face__look {
  animation: sa-face-look 6.4s ease-in-out infinite;
}

.sa-face.is-running .sa-face__blink {
  animation: sa-face-blink 4.6s ease-in-out infinite;
}

/* 左顾右盼：短暂看向左侧，再看向右侧，其余时间回正 */
@keyframes sa-face-look {
  0%, 16%, 100% {
    transform: translateX(0);
  }

  24%, 36% {
    transform: translateX(-2px);
  }

  /* 眼睛基准位置偏右（为左下角徽标留空间）：右侧位移收一点，
     否则最右帧只剩 1 格留白、贴到脸缘。左侧留白足够，保持 2px。 */
  44%, 56% {
    transform: translateX(1.2px);
  }

  64%, 84% {
    transform: translateX(0);
  }
}

/* 眨眼：每轮只眨一次，压到接近一条线，避免持续抖动 */
@keyframes sa-face-blink {
  0%, 39%, 45%, 100% {
    transform: scaleY(1);
  }

  42% {
    transform: scaleY(0.12);
  }
}

.sa-face__done circle {
  fill: var(--gd-color-success);
  stroke: var(--gd-color-bg);
}

.sa-face__done path {
  fill: none;
  stroke: #fff;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sa-face__failed circle {
  fill: var(--gd-color-danger);
  stroke: var(--gd-color-bg);
}

.sa-face__failed path {
  fill: none;
  stroke: #fff;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (prefers-reduced-motion: reduce) {
  .sa-face.is-running .sa-face__look,
  .sa-face.is-running .sa-face__blink {
    animation: none;
  }
}
</style>
