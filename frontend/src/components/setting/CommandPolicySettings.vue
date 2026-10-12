<template>
  <div class="space-y-4">
    <!-- 说明 + 文件位置 -->
    <div class="rounded-lg border border-(--gd-color-surface-border) dark:border-gray-700 p-4 space-y-2">
      <div class="flex items-center gap-2">
        <ShieldCheckmark16Regular class="w-4 h-4 text-blue-500" />
        <span class="text-sm font-medium">{{ t('settings.policy.title') }}</span>
      </div>
      <div class="text-xs leading-5 space-y-0.5">
        <p class="text-gray-500 dark:text-gray-400">
          <span class="font-medium text-gray-600 dark:text-gray-300">{{ t('settings.policy.readOnlyTitle') }}</span>
          — {{ t('settings.policy.readOnlyDefault') }}
        </p>
        <p class="text-gray-500 dark:text-gray-400">
          <span class="font-medium text-gray-600 dark:text-gray-300">{{ t('settings.policy.workTitle') }}</span>
          — {{ t('settings.policy.workDefault') }}
        </p>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.policy.factoryHint') }}</p>
      <div class="text-xs font-mono text-gray-500 dark:text-gray-400 space-y-1 pt-1">
        <div>{{ t('settings.policy.fileGlobal') }}：{{ effective?.paths.global || '—' }}</div>
        <div>{{ t('settings.policy.fileProject') }}</div>
      </div>
    </div>

    <!-- 校验告警 -->
    <el-alert
      v-for="(w, i) in effective?.warnings || []"
      :key="i"
      :title="w"
      type="warning"
      :closable="false"
      show-icon
    />

    <!-- ① 只读档名单 -->
    <div class="rounded-lg border border-(--gd-color-surface-border) dark:border-gray-700 p-4 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="text-sm font-medium">{{ t('settings.policy.readOnlyListTitle') }}</div>
          <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.policy.readOnlyListHint') }}</p>
        </div>
        <span class="text-xs text-gray-400 shrink-0">
          {{ t('settings.policy.count', { n: readOnlyRows.length }) }}
        </span>
      </div>
      <el-input v-model="readOnlySearch" clearable size="small" :placeholder="t('settings.policy.searchPlaceholder')" />
      <div class="max-h-56 overflow-y-auto rounded border border-(--gd-color-surface-border) dark:border-gray-700 divide-y divide-(--gd-color-surface-border) dark:divide-gray-700">
        <div
          v-for="row in filteredReadOnlyRows"
          :key="row.key"
          class="flex items-center justify-between gap-2 px-2 py-1 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <span class="truncate">{{ row.label }}</span>
          <span class="flex items-center gap-1 shrink-0">
            <el-tag size="small" :type="row.builtin ? 'info' : 'warning'" effect="plain">
              {{ row.builtin ? t('settings.policy.tagBuiltin') : t('settings.policy.tagMine') }}
            </el-tag>
            <el-button link type="danger" size="small" @click="removeReadOnlyRow(row)">
              {{ t('settings.policy.remove') }}
            </el-button>
          </span>
        </div>
        <div v-if="filteredReadOnlyRows.length === 0" class="px-2 py-3 text-xs text-gray-400 text-center">
          {{ t('settings.policy.empty') }}
        </div>
      </div>
      <div class="flex items-center gap-2">
        <el-input
          v-model="newReadOnly"
          size="small"
          class="flex-1 min-w-0"
          :placeholder="t('settings.policy.readOnlyAddPlaceholder')"
          @keyup.enter="addReadOnly"
        />
        <el-button size="small" :disabled="!newReadOnly.trim()" @click="addReadOnly">
          {{ t('settings.policy.add') }}
        </el-button>
      </div>
      <p class="text-xs text-gray-400">{{ t('settings.policy.readOnlyCustomWarn') }}</p>
    </div>

    <!-- ② 工作档必问项 + 敏感路径 -->
    <div class="rounded-lg border border-(--gd-color-surface-border) dark:border-gray-700 p-4 space-y-2">
      <div>
        <div class="text-sm font-medium">{{ t('settings.policy.askTitle') }}</div>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.policy.askHint') }}</p>
      </div>
      <div class="max-h-48 overflow-y-auto rounded border border-(--gd-color-surface-border) dark:border-gray-700 divide-y divide-(--gd-color-surface-border) dark:divide-gray-700">
        <div
          v-for="row in askRows"
          :key="row.key"
          class="flex items-center justify-between gap-2 px-2 py-1 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <span class="truncate">{{ row.label }}</span>
          <span class="flex items-center gap-1 shrink-0">
            <el-tag size="small" :type="row.builtin ? 'info' : 'warning'" effect="plain">
              {{ row.builtin ? t('settings.policy.tagBuiltin') : t('settings.policy.tagMine') }}
            </el-tag>
            <el-button link type="danger" size="small" @click="removeAskRow(row)">
              {{ t('settings.policy.remove') }}
            </el-button>
          </span>
        </div>
        <div v-if="askRows.length === 0" class="px-2 py-3 text-xs text-gray-400 text-center">
          {{ t('settings.policy.empty') }}
        </div>
      </div>

      <div class="pt-1">
        <div class="text-sm font-medium">{{ t('settings.policy.sensitiveTitle') }}</div>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.policy.sensitiveHint') }}</p>
      </div>
      <div class="max-h-48 overflow-y-auto rounded border border-(--gd-color-surface-border) dark:border-gray-700 divide-y divide-(--gd-color-surface-border) dark:divide-gray-700">
        <div
          v-for="row in sensitiveRows"
          :key="row.key"
          class="flex items-center justify-between gap-2 px-2 py-1 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <span class="truncate">{{ row.label }}</span>
          <span class="flex items-center gap-1 shrink-0">
            <el-tag size="small" :type="row.allowed ? 'success' : 'info'" effect="plain">
              {{ row.allowed ? t('settings.policy.allowed') : t('settings.policy.askOnce') }}
            </el-tag>
            <el-button v-if="!row.allowed" link type="primary" size="small" @click="allowSensitiveRow(row)">
              {{ t('settings.policy.allowThis') }}
            </el-button>
            <el-button v-else link type="danger" size="small" @click="removePathRule(row.label)">
              {{ t('settings.policy.revoke') }}
            </el-button>
          </span>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <el-select v-model="newRuleAction" size="small" style="width: 96px" class="shrink-0">
          <el-option value="ask" :label="t('settings.policy.action.ask')" />
          <el-option value="deny" :label="t('settings.policy.action.deny')" />
        </el-select>
        <el-input
          v-model="newRule"
          size="small"
          class="flex-1 min-w-0"
          :placeholder="t('settings.policy.rulePlaceholder')"
          @keyup.enter="addRule"
        />
        <el-button size="small" :disabled="!newRule.trim()" @click="addRule">
          {{ t('settings.policy.add') }}
        </el-button>
      </div>
    </div>

    <!-- ③ 可写根 -->
    <div class="rounded-lg border border-(--gd-color-surface-border) dark:border-gray-700 p-4 space-y-2">
      <div>
        <div class="text-sm font-medium">{{ t('settings.policy.writeRootsTitle') }}</div>
        <p class="text-xs text-gray-500 dark:text-gray-400">{{ t('settings.policy.writeRootsHint') }}</p>
      </div>
      <div class="max-h-48 overflow-y-auto rounded border border-(--gd-color-surface-border) dark:border-gray-700 divide-y divide-(--gd-color-surface-border) dark:divide-gray-700">
        <div
          v-for="row in writeRootRows"
          :key="row.key"
          class="flex items-center justify-between gap-2 px-2 py-1 text-xs font-mono hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <span class="truncate">{{ row.label }}</span>
          <span class="flex items-center gap-1 shrink-0">
            <el-tag size="small" :type="row.builtin ? 'info' : 'warning'" effect="plain">
              {{ row.builtin ? t('settings.policy.tagBuiltin') : t('settings.policy.tagMine') }}
            </el-tag>
            <el-button link type="danger" size="small" @click="removeWriteRootRow(row)">
              {{ row.builtin ? t('settings.policy.askInstead') : t('settings.policy.remove') }}
            </el-button>
          </span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <el-input
          v-model="newWriteRoot"
          size="small"
          class="flex-1 min-w-0"
          :placeholder="t('settings.policy.writeRootPlaceholder')"
          @keyup.enter="addWriteRoot"
        />
        <el-button size="small" :disabled="!newWriteRoot.trim()" @click="addWriteRoot">
          {{ t('settings.policy.add') }}
        </el-button>
      </div>
      <p class="text-xs text-gray-400">{{ t('settings.policy.writeRootsWarn') }}</p>
    </div>

    <div class="flex items-center gap-2 pt-1">
      <el-button type="primary" :loading="saving" @click="save">
        {{ t('settings.policy.save') }}
      </el-button>
      <el-button :disabled="saving" @click="resetUser">
        {{ t('settings.policy.reset') }}
      </el-button>
      <span class="text-xs text-gray-400">{{ t('settings.policy.resetHint') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ShieldCheckmark16Regular } from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import type {
  EffectivePolicyView,
  FactoryPolicy,
  PathRule,
  PolicyRule,
  RuleAction,
} from '@/services/modules/policy.api'

const { t } = useI18n()

const effective = ref<EffectivePolicyView | null>(null)
const factory = ref<FactoryPolicy>({ readOnly: [], ask: [], sensitive: [], writeRoots: [] })
const userRules = ref<PolicyRule[]>([])
const readOnlyRemove = ref<string[]>([])
const saving = ref(false)

const readOnlySearch = ref('')
const newReadOnly = ref('')
const newRule = ref('')
const newRuleAction = ref<RuleAction>('ask')
const newWriteRoot = ref('')

const isPathRule = (rule: PolicyRule): rule is PathRule => 'path' in rule

/** 只读名单 = 出厂（减去划掉）+ 你的命令 allow 规则 */
const readOnlyRows = computed(() => [
  ...(effective.value?.readOnlyEffective ?? []).map((entry) => ({
    key: `b:${entry}`,
    label: entry,
    builtin: true,
  })),
  ...userRules.value
    .filter((r) => !isPathRule(r) && r.action === 'allow')
    .map((r) => ({ key: `u:${(r as { match: string }).match}`, label: (r as { match: string }).match, builtin: false })),
])

const filteredReadOnlyRows = computed(() => {
  const q = readOnlySearch.value.trim().toLowerCase()
  if (!q) return readOnlyRows.value
  return readOnlyRows.value.filter((row) => row.label.toLowerCase().includes(q))
})

/** 必问项 = 出厂必问项 + 你的 ask/deny 命令规则 */
const askRows = computed(() => [
  ...factory.value.ask.map((match) => ({ key: `b:${match}`, label: match, builtin: true })),
  ...userRules.value
    .filter((r) => !isPathRule(r) && r.action !== 'allow')
    .map((r) => ({
      key: `u:${r.action}:${(r as { match: string }).match}`,
      label: `${r.action === 'deny' ? t('settings.policy.action.deny') : t('settings.policy.action.ask')} ${(r as { match: string }).match}`,
      builtin: false,
    })),
])

/** 敏感路径 = 出厂清单 + 你的路径规则覆盖（allow = 已放通） */
const sensitiveRows = computed(() =>
  factory.value.sensitive.map((path) => {
    const override = userRules.value.find((r) => isPathRule(r) && r.path === path)
    return {
      key: path,
      label: path,
      allowed: override?.action === 'allow',
    }
  }),
)

/** 可写根 = 出厂 + 你的路径 allow 规则 */
const writeRootRows = computed(() => [
  ...factory.value.writeRoots.map((path) => ({ key: `b:${path}`, label: path, builtin: true })),
  ...userRules.value
    .filter((r) => isPathRule(r) && r.action === 'allow')
    .map((r) => ({ key: `u:${(r as PathRule).path}`, label: (r as PathRule).path, builtin: false })),
])

function applyEffective(data: EffectivePolicyView) {
  effective.value = data
  factory.value = data.factory
  userRules.value = data.userRules.map((r) => ({ ...r }))
  readOnlyRemove.value = [...data.readOnlyRemove]
}

async function load() {
  try {
    applyEffective(await apiService.fetchPolicyRules())
  } catch (e) {
    ElMessage.error(`${t('settings.policy.loadFailed')}: ${(e as Error).message || e}`)
  }
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

function addReadOnly() {
  const match = norm(newReadOnly.value)
  if (!match) return
  if (userRules.value.some((r) => !isPathRule(r) && r.action === 'allow' && r.match === match)) {
    ElMessage.warning(t('settings.policy.duplicate'))
    return
  }
  userRules.value.push({ action: 'allow', match })
  newReadOnly.value = ''
}

function addRule() {
  const match = norm(newRule.value)
  if (!match) return
  userRules.value.push({ action: newRuleAction.value, match })
  newRule.value = ''
}

function addWriteRoot() {
  const path = norm(newWriteRoot.value)
  if (!path) return
  if (userRules.value.some((r) => isPathRule(r) && r.path === path)) {
    ElMessage.warning(t('settings.policy.duplicate'))
    return
  }
  userRules.value.push({ action: 'allow', path })
  newWriteRoot.value = ''
}

function removeReadOnlyRow(row: { label: string; builtin: boolean }) {
  if (row.builtin) {
    if (!readOnlyRemove.value.includes(row.label)) readOnlyRemove.value.push(row.label)
    return
  }
  userRules.value = userRules.value.filter(
    (r) => !(!isPathRule(r) && r.action === 'allow' && r.match === row.label),
  )
}

function removeAskRow(row: { key: string; label: string; builtin: boolean }) {
  if (row.builtin) {
    // 删掉内置必问项 = 放通：写一条 allow 覆盖（比"移除出厂规则"更明确）
    userRules.value.push({ action: 'allow', match: row.label })
    return
  }
  const [, action, match] = row.key.split(':')
  userRules.value = userRules.value.filter(
    (r) => !(!isPathRule(r) && r.action === action && r.match === match),
  )
}

function allowSensitiveRow(row: { label: string }) {
  if (userRules.value.some((r) => isPathRule(r) && r.path === row.label && r.action === 'allow')) return
  userRules.value = userRules.value.filter((r) => !(isPathRule(r) && r.path === row.label))
  userRules.value.push({ action: 'allow', path: row.label })
}

function removePathRule(path: string) {
  userRules.value = userRules.value.filter((r) => !(isPathRule(r) && r.path === path))
}

function removeWriteRootRow(row: { key: string; label: string; builtin: boolean }) {
  if (!row.builtin) {
    removePathRule(row.label)
    return
  }
  // 出厂可写根：不改出厂规则，而是写一条 ask 覆盖（"这一条我不想静默可写"）
  userRules.value = userRules.value.filter((r) => !(isPathRule(r) && r.path === row.label))
  userRules.value.push({ action: 'ask', path: row.label })
}

async function save() {
  saving.value = true
  try {
    applyEffective(
      await apiService.updatePolicyRules({
        scope: 'global',
        content: { rules: userRules.value, readOnlyRemove: readOnlyRemove.value },
      }),
    )
    ElMessage.success(t('common.saveSuccess'))
  } catch (e) {
    ElMessage.error(`${t('settings.policy.saveFailed')}: ${(e as Error).message || e}`)
  } finally {
    saving.value = false
  }
}

async function resetUser() {
  try {
    await ElMessageBox.confirm(t('settings.policy.resetConfirm'), t('settings.policy.reset'), {
      type: 'warning',
    })
  } catch {
    return
  }
  saving.value = true
  try {
    applyEffective(await apiService.resetPolicyRules())
    ElMessage.success(t('common.saveSuccess'))
  } catch (e) {
    ElMessage.error(`${t('settings.policy.saveFailed')}: ${(e as Error).message || e}`)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>
