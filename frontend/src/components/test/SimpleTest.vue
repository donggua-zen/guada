<template>
  <div style="height: 100vh; padding: 20px;">
    <h2>LiteSplitpanes 简单测试</h2>
    
    <div style="height: 400px; border: 2px solid red;">
      <LiteSplitpanes
        style="height: 100%;"
        :pane1="{ size: 50, minSize: 20, maxSize: 80 }"
        :pane2="{ size: 50, minSize: 20, maxSize: 80 }"
      >
        <template #pane1>
          <div style="background: lightblue; height: 100%; padding: 20px;">
            <h3>Pane 1</h3>
            <p>这是第一个面板</p>
          </div>
        </template>
        
        <template #pane2>
          <div style="background: lightgreen; height: 100%; padding: 20px;">
            <h3>Pane 2</h3>
            <p>这是第二个面板</p>
          </div>
        </template>
      </LiteSplitpanes>
    </div>
    
    <div style="margin-top: 20px;">
      <p>如果看到两个彩色面板，说明组件正常工作。</p>
      <p>尝试拖拽中间的分割条来调整大小。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { LiteSplitpanes } from '../ui';
</script>
