<template>
  <div class="demo-settings-panel">
    <h3>{{ t('title') }}</h3>
    <p>{{ t('hint') }}</p>
    <p>{{ t('user') }}: <b>{{ userLabel }}</b>（role: {{ userRole }}）</p>
    <p>{{ t('lang') }}: {{ locale }}</p>
    <div class="actions">
      <GdButton type="primary" size="small" @click="loadInfo">{{ t('callRpc') }}</GdButton>
      <GdButton size="small" @click="save">{{ t('saveRpc') }}</GdButton>
    </div>
    <div v-if="info" class="result">
      <b>{{ t('rpcResult') }}:</b>
      <pre>{{ infoText }}</pre>
    </div>
    <p v-if="saveResult" class="save-ok">{{ t('saveResult') }}: {{ saveResult }}</p>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

// 共享依赖从 window.__GuaDaShared__ 取（单实例保证，产物不 import 共享模块）
const { i18n, runtime, pluginApi } = window.__GuaDaShared__

const t = (key) => i18n.t('demo-settings', key, {})
const info = ref(null)
const saveResult = ref('')

const userLabel = computed(() =>
  runtime.user
    ? runtime.user.nickname || runtime.user.username || runtime.user.id || '?'
    : t('notLogin'),
)
const userRole = computed(() => (runtime.user ? runtime.user.role : '-'))
const locale = computed(() => runtime.locale)
const infoText = computed(() => (info.value ? JSON.stringify(info.value, null, 2) : ''))

async function loadInfo() {
  info.value = await pluginApi.call('demo-settings', 'getInfo', {})
}
async function save() {
  const r = await pluginApi.call('demo-settings', 'saveConfig', { hello: 'world', n: 42 })
  saveResult.value = JSON.stringify(r)
}
</script>

<style scoped>
.demo-settings-panel { padding: 16px; }
.actions { display: flex; gap: 8px; margin: 8px 0; }
.result { margin: 8px 0; }
.result pre { background: var(--gd-color-surface); border: 1px solid var(--gd-color-border); padding: 8px; border-radius: 4px; }
.save-ok { color: #16a34a; }
</style>