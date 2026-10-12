<template>
  <div class="space-y-4">
    <!-- 说明 + 文件位置 -->
    <div class="rounded-lg border border-(--gd-color-surface-border) dark:border-gray-700 p-4 space-y-2">
      <div class="flex items-center gap-2">
        <ShieldCheckmark16Regular class="w-4 h-4 text-blue-500" />
        <span class="text-sm font-medium">{{ t('settings.policy.title') }}</span>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 leading-5">{{ t('settings.policy.intro') }}</p>
      <div class="text-xs font-mono text-gray-500 dark:text-gray-400 space-y-1 pt-1">
        <div>{{ t('settings.policy.fileGlobal') }}：{{ effective?.paths.global || '—' }}</div>
        <div>{{ t('settings.policy.fileProject') }}</div>
      </div>
    </div>

    <!-- 校验告警（不阻断保存） -->
    <el-alert
      v-for="(w, i) in effective?.warnings || []"
      :key="i"
      :title="w"
      type="warning"
      :closable="false"
      show-icon
    />

    <!-- 四个列表：一行一条 -->
    <div v-for="list in lists" :key="list.key" class="space-y-1">
      <div class="text-sm font-medium">{{ t(list.labelKey) }}</div>
      <p class="text-xs text-gray-500 dark:text-gray-400">{{ t(list.hintKey) }}</p>
      <el-input
        v-model="texts[list.key]"
        type="textarea"
        :rows="list.rows"
        :placeholder="t(list.placeholderKey)"
        spellcheck="false"
      />
    </div>

    <div class="flex items-center gap-2 pt-1">
      <el-button type="primary" :loading="saving" @click="save">
        {{ t('settings.policy.save') }}
      </el-button>
      <el-button :disabled="saving" @click="clearAll">{{ t('settings.policy.reset') }}</el-button>
      <span v-if="loaded" class="text-xs text-gray-400">{{ t('settings.policy.loadedHint') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ShieldCheckmark16Regular } from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import type { EffectivePolicyRules, PolicyRulesFile } from '@/services/modules/policy.api'

const { t } = useI18n()

const effective = ref<EffectivePolicyRules | null>(null)
const saving = ref(false)
const loaded = ref(false)

const texts = reactive({ allow: '', ask: '', deny: '', writeAllowPaths: '' })

const lists = [
  {
    key: 'allow' as const,
    labelKey: 'settings.policy.allowLabel',
    hintKey: 'settings.policy.allowHint',
    placeholderKey: 'settings.policy.allowPlaceholder',
    rows: 5,
  },
  {
    key: 'ask' as const,
    labelKey: 'settings.policy.askLabel',
    hintKey: 'settings.policy.askHint',
    placeholderKey: 'settings.policy.askPlaceholder',
    rows: 3,
  },
  {
    key: 'deny' as const,
    labelKey: 'settings.policy.denyLabel',
    hintKey: 'settings.policy.denyHint',
    placeholderKey: 'settings.policy.denyPlaceholder',
    rows: 3,
  },
  {
    key: 'writeAllowPaths' as const,
    labelKey: 'settings.policy.writePathsLabel',
    hintKey: 'settings.policy.writePathsHint',
    placeholderKey: 'settings.policy.writePathsPlaceholder',
    rows: 2,
  },
]

const toText = (list: readonly string[]) => (list || []).join('\n')
const fromText = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

function applyEffective(data: EffectivePolicyRules) {
  effective.value = data
  texts.allow = toText(data.sources.global.allow)
  texts.ask = toText(data.sources.global.ask)
  texts.deny = toText(data.sources.global.deny)
  texts.writeAllowPaths = toText(data.sources.global.writeAllowPaths)
}

async function load() {
  try {
    applyEffective(await apiService.fetchPolicyRules())
    loaded.value = true
  } catch (e) {
    ElMessage.error(`${t('settings.policy.loadFailed')}: ${(e as Error).message || e}`)
  }
}

async function save() {
  saving.value = true
  try {
    const rules: PolicyRulesFile = {
      allow: fromText(texts.allow),
      ask: fromText(texts.ask),
      deny: fromText(texts.deny),
      writeAllowPaths: fromText(texts.writeAllowPaths),
    }
    applyEffective(await apiService.updatePolicyRules({ scope: 'global', rules }))
    ElMessage.success(t('common.saveSuccess'))
  } catch (e) {
    ElMessage.error(`${t('settings.policy.saveFailed')}: ${(e as Error).message || e}`)
  } finally {
    saving.value = false
  }
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(t('settings.policy.resetConfirm'), t('settings.policy.reset'), {
      type: 'warning',
    })
  } catch {
    return
  }
  texts.allow = ''
  texts.ask = ''
  texts.deny = ''
  texts.writeAllowPaths = ''
  await save()
}

onMounted(load)
</script>
