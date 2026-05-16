<template>
  <div class="perf-test-page">
    <h2>Splitpanes 性能对比测试</h2>

    <div class="controls">
      <el-button type="primary" @click="runAutoTest" :loading="isTesting">
        {{ isTesting ? '测试中...' : '运行自动化测试' }}
      </el-button>
      <el-button @click="reset">重置</el-button>
      <span class="hint">手动拖拽分割条也可查看实时数据</span>
    </div>

    <div class="test-container">
      <!-- 左侧：原生 splitpanes -->
      <div class="test-section">
        <h3>原生 splitpanes</h3>
        <div ref="nativeContainer" class="split-container">
          <Splitpanes
            class="default-theme"
            style="height: 100%"
            @resize="onNativeResize"
            @resized="onNativeResized"
          >
            <Pane :size="50" :min-size="20" :max-size="80">
              <div class="pane-content native-pane">
                <p>Pane 1</p>
                <div v-for="i in 50" :key="i" class="dummy-item">Item {{ i }}</div>
              </div>
            </Pane>
            <Pane :size="50" :min-size="20" :max-size="80">
              <div class="pane-content native-pane">
                <p>Pane 2</p>
                <div v-for="i in 50" :key="i" class="dummy-item">Item {{ i }}</div>
              </div>
            </Pane>
          </Splitpanes>
        </div>
        <div class="metrics">
          <div class="metric">
            <span class="label">FPS:</span>
            <span class="value" :class="getFpsClass(nativeMetrics.fps)">{{ nativeMetrics.fps }}</span>
          </div>
          <div class="metric">
            <span class="label">帧耗时:</span>
            <span class="value">{{ nativeMetrics.frameTime }}ms</span>
          </div>
          <div class="metric">
            <span class="label">LongTasks:</span>
            <span class="value" :class="{ 'bad': nativeMetrics.longTasks > 0 }">{{ nativeMetrics.longTasks }}</span>
          </div>
          <div class="metric">
            <span class="label">内存变化:</span>
            <span class="value">{{ formatBytes(nativeMetrics.memoryDelta) }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧：LiteSplitpanes -->
      <div class="test-section">
        <h3>LiteSplitpanes</h3>
        <div ref="liteContainer" class="split-container">
          <LiteSplitpanes
            style="height: 100%"
            :pane1="{ size: 50, minSize: 20, maxSize: 80 }"
            :pane2="{ size: 50, minSize: 20, maxSize: 80 }"
            @resize="onLiteResize"
            @resized="onLiteResized"
          >
            <template #pane1>
              <div class="pane-content lite-pane">
                <p>Pane 1</p>
                <div v-for="i in 50" :key="i" class="dummy-item">Item {{ i }}</div>
              </div>
            </template>
            <template #pane2>
              <div class="pane-content lite-pane">
                <p>Pane 2</p>
                <div v-for="i in 50" :key="i" class="dummy-item">Item {{ i }}</div>
              </div>
            </template>
          </LiteSplitpanes>
        </div>
        <div class="metrics">
          <div class="metric">
            <span class="label">FPS:</span>
            <span class="value" :class="getFpsClass(liteMetrics.fps)">{{ liteMetrics.fps }}</span>
          </div>
          <div class="metric">
            <span class="label">帧耗时:</span>
            <span class="value">{{ liteMetrics.frameTime }}ms</span>
          </div>
          <div class="metric">
            <span class="label">LongTasks:</span>
            <span class="value" :class="{ 'bad': liteMetrics.longTasks > 0 }">{{ liteMetrics.longTasks }}</span>
          </div>
          <div class="metric">
            <span class="label">内存变化:</span>
            <span class="value">{{ formatBytes(liteMetrics.memoryDelta) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 对比总结 -->
    <div v-if="hasResult" class="summary">
      <h3>测试结果对比</h3>
      <el-table :data="compareData" style="width: 100%">
        <el-table-column prop="metric" label="指标" width="120" />
        <el-table-column prop="native" label="原生 splitpanes" />
        <el-table-column prop="lite" label="LiteSplitpanes" />
        <el-table-column prop="diff" label="差异">
          <template #default="{ row }">
            <span :class="row.better ? 'better' : 'worse'">{{ row.diff }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { LiteSplitpanes } from '../ui';
import { usePerfMonitor } from '@/composables/usePerfMonitor';
import { ElButton, ElTable, ElTableColumn } from 'element-plus';

// 原生 splitpanes 性能监控
const nativeMonitor = usePerfMonitor();
const nativeMetrics = nativeMonitor.metrics;

// LiteSplitpanes 性能监控
const liteMonitor = usePerfMonitor();
const liteMetrics = liteMonitor.metrics;

const isTesting = ref(false);
const hasResult = ref(false);

/**
 * 获取 FPS 样式类
 */
function getFpsClass(fps: number): string {
  if (fps >= 55) return 'good';
  if (fps >= 30) return 'warning';
  return 'bad';
}

/**
 * 格式化字节
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 原生 resize 开始
 */
function onNativeResize() {
  if (!nativeMonitor.isMonitoring.value) {
    nativeMonitor.start();
  }
}

/**
 * 原生 resize 结束
 */
function onNativeResized() {
  nativeMonitor.stop();
  if (!isTesting.value) {
    hasResult.value = true;
  }
}

/**
 * Lite resize 开始
 */
function onLiteResize() {
  if (!liteMonitor.isMonitoring.value) {
    liteMonitor.start();
  }
}

/**
 * Lite resize 结束
 */
function onLiteResized() {
  liteMonitor.stop();
  if (!isTesting.value) {
    hasResult.value = true;
  }
}

/**
 * 对比数据
 */
const compareData = computed(() => {
  const n = nativeMetrics.value;
  const l = liteMetrics.value;
  return [
    {
      metric: 'FPS',
      native: n.fps,
      lite: l.fps,
      diff: `${l.fps - n.fps > 0 ? '+' : ''}${l.fps - n.fps}`,
      better: l.fps >= n.fps
    },
    {
      metric: '帧耗时(ms)',
      native: n.frameTime,
      lite: l.frameTime,
      diff: `${l.frameTime - n.frameTime > 0 ? '+' : ''}${(l.frameTime - n.frameTime).toFixed(2)}`,
      better: l.frameTime <= n.frameTime
    },
    {
      metric: 'LongTasks',
      native: n.longTasks,
      lite: l.longTasks,
      diff: `${l.longTasks - n.longTasks > 0 ? '+' : ''}${l.longTasks - n.longTasks}`,
      better: l.longTasks <= n.longTasks
    },
    {
      metric: '内存变化',
      native: formatBytes(n.memoryDelta),
      lite: formatBytes(l.memoryDelta),
      diff: formatBytes(l.memoryDelta - n.memoryDelta),
      better: l.memoryDelta <= n.memoryDelta
    }
  ];
});

/**
 * 运行自动化测试
 * 模拟拖拽分割条 100 次
 */
async function runAutoTest() {
  isTesting.value = true;
  hasResult.value = false;

  // 等待 UI 更新
  await new Promise(resolve => setTimeout(resolve, 100));

  // 同时测试两个组件
  nativeMonitor.start();
  liteMonitor.start();

  // 模拟拖拽：左右移动分割条
  const nativeSplitter = document.querySelector('.test-section:first-child .splitpanes__splitter') as HTMLElement;
  const liteSplitter = document.querySelector('.test-section:last-child .lite-splitpanes__splitter') as HTMLElement;

  if (nativeSplitter && liteSplitter) {
    const nativeRect = nativeSplitter.getBoundingClientRect();
    const liteRect = liteSplitter.getBoundingClientRect();

    // 模拟 20 次拖拽循环
    for (let i = 0; i < 20; i++) {
      const offset = Math.sin(i * 0.5) * 100;

      // 触发原生 mousedown
      nativeSplitter.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: nativeRect.left + nativeRect.width / 2,
        clientY: nativeRect.top + nativeRect.height / 2
      }));

      // 触发 Lite mousedown
      liteSplitter.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        clientX: liteRect.left + liteRect.width / 2,
        clientY: liteRect.top + liteRect.height / 2
      }));

      // 模拟移动
      for (let j = 0; j < 5; j++) {
        await new Promise(resolve => setTimeout(resolve, 16));
        const moveX = offset * (j / 4);

        document.dispatchEvent(new MouseEvent('mousemove', {
          clientX: nativeRect.left + nativeRect.width / 2 + moveX,
          clientY: nativeRect.top + nativeRect.height / 2
        }));

        document.dispatchEvent(new MouseEvent('mousemove', {
          clientX: liteRect.left + liteRect.width / 2 + moveX,
          clientY: liteRect.top + liteRect.height / 2
        }));
      }

      // 触发 mouseup
      document.dispatchEvent(new MouseEvent('mouseup'));

      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  nativeMonitor.stop();
  liteMonitor.stop();

  isTesting.value = false;
  hasResult.value = true;
}

/**
 * 重置测试
 */
function reset() {
  hasResult.value = false;
  nativeMetrics.value = { fps: 0, frameTime: 0, longTasks: 0, layoutTime: 0, memoryDelta: 0 };
  liteMetrics.value = { fps: 0, frameTime: 0, longTasks: 0, layoutTime: 0, memoryDelta: 0 };
}
</script>

<style scoped>
.perf-test-page {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

h2 {
  margin-bottom: 16px;
  font-size: 20px;
  font-weight: 600;
}

.controls {
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.hint {
  color: #999;
  font-size: 13px;
}

.test-container {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.test-section {
  flex: 1;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
}

.test-section h3 {
  margin-bottom: 12px;
  font-size: 16px;
  font-weight: 600;
}

.split-container {
  height: 300px;
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.pane-content {
  padding: 12px;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
}

.native-pane {
  background: #f0f7ff;
}

.lite-pane {
  background: #f0fff4;
}

.dummy-item {
  padding: 4px 8px;
  margin: 2px 0;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 3px;
  font-size: 12px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.metric {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  background: white;
  border-radius: 4px;
  font-size: 13px;
}

.metric .label {
  color: #666;
}

.metric .value {
  font-weight: 600;
  font-family: monospace;
}

.value.good {
  color: #52c41a;
}

.value.warning {
  color: #faad14;
}

.value.bad {
  color: #f5222d;
}

.summary {
  margin-top: 20px;
  padding: 16px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
}

.summary h3 {
  margin-bottom: 12px;
}

.better {
  color: #52c41a;
  font-weight: 600;
}

.worse {
  color: #f5222d;
  font-weight: 600;
}

.dark .test-section {
  background: #1a1b1e;
  border-color: #2e3035;
}

.dark .split-container {
  border-color: #2e3035;
}

.dark .native-pane {
  background: #1a2332;
}

.dark .lite-pane {
  background: #1a2e23;
}

.dark .dummy-item {
  background: rgba(255, 255, 255, 0.05);
}

.dark .metric {
  background: #25262a;
}

.dark .summary {
  background: #1a1b1e;
  border-color: #2e3035;
}
</style>
