<template>
  <div class="lite-pane">
    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * LitePane - 轻量级分割面板子组件
 *
 * 该组件本身不处理任何尺寸逻辑，仅作为内容容器。
 * 所有尺寸控制由父组件 LiteSplitpanes 通过 slot 分发管理。
 *
 * 保留此组件是为了与 splitpanes 的 <Pane> 接口保持兼容，
 * 方便在模板中直观表达面板结构。
 */
</script>

<style scoped>
.lite-pane {
  /* position: relative;
  overflow: hidden; */
  display: flex;
  width: 100%;
  height: 100%;
}
</style>
