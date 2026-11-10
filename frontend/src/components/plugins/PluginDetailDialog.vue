<template>
  <GdDialog :model-value="visible" @update:model-value="(v: boolean) => emit('update:visible', v)" size="md"
    align-center destroy-on-close>
    <template #header>
      <div class="flex items-center gap-3 min-w-0">
        <CardAvatar :src="iconSrc" :name="displayName" size="md" tray />
        <div class="flex items-center gap-2 flex-wrap min-w-0">
          <span class="text-base font-semibold text-gray-900 dark:text-[#e8e9ed] truncate">{{ displayName }}</span>
          <GdTag v-if="plugin?.version" size="small" type="info" effect="plain">v{{ plugin.version }}</GdTag>
          <GdTag v-if="plugin?.providerApi" size="small" type="primary" effect="plain">
            {{ t('plugins.localTools.sourceProvider') }}
          </GdTag>
          <GdTag v-if="plugin?.source === 'dev'" size="small" type="warning" effect="dark">
            {{ t('plugins.localTools.sourceDev') }}
          </GdTag>
          <GdTag v-else-if="plugin?.source === 'user'" size="small" type="success" effect="plain">
            {{ t('plugins.localTools.sourceUser') }}
          </GdTag>
          <GdTag v-if="data && !data.enabled" size="small" type="warning" effect="dark">
            {{ t('plugins.localTools.detail.disabledTag') }}
          </GdTag>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <!-- 描述 -->
      <p v-if="description" class="text-sm text-gray-700 dark:text-[#d0d1d5] leading-relaxed">{{ description }}</p>

      <!-- 停用提示：贡献仍完整展示，但不是生效面 -->
      <GdAlert v-if="data && !data.enabled" type="warning" :title="t('plugins.localTools.detail.disabledHint')" />

      <!-- 加载态 -->
      <div v-if="loading" class="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
        <ArrowSync16Regular class="w-4 h-4 animate-spin" />
        {{ t('plugins.localTools.detail.loading') }}
      </div>

      <template v-else-if="data">
        <!-- 能力概览芯片：只显示 > 0 的类别 -->
        <div v-if="overviewChips.length > 0" class="flex flex-wrap gap-1.5">
          <GdTag v-for="chip in overviewChips" :key="chip.key" size="small" type="info" effect="plain">
            {{ chip.label }} {{ chip.count }}
          </GdTag>
        </div>

        <!-- 智能体 -->
        <section v-if="data.counts.agents > 0" class="pd-section">
          <div class="pd-section-head">
            <Bot20Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.agents') }}</span>
            <GdTag size="small" type="info" effect="plain">{{ data.counts.agents }}</GdTag>
          </div>
          <div class="pd-list">
            <div v-for="a in data.contributions.agents" :key="a.agentId" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ a.name || a.defId }}</span>
                <span v-if="a.description" class="pd-desc">{{ a.description }}</span>
              </div>
              <span class="pd-meta">{{ a.agentId }}</span>
            </div>
          </div>
        </section>

        <!-- 技能 -->
        <section v-if="data.counts.skills > 0" class="pd-section">
          <div class="pd-section-head">
            <BookOpen20Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.skills') }}</span>
            <GdTag size="small" type="info" effect="plain">{{ data.counts.skills }}</GdTag>
          </div>
          <div class="pd-list">
            <div v-for="s in data.contributions.skills" :key="s.id" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ s.name || s.id }}</span>
                <span v-if="s.description" class="pd-desc">{{ s.description }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 提示词 -->
        <section v-if="data.counts.promptSections > 0" class="pd-section">
          <div class="pd-section-head">
            <TextDescription20Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.prompts') }}</span>
            <GdTag size="small" type="info" effect="plain">{{ data.counts.promptSections }}</GdTag>
          </div>
          <div class="pd-list">
            <div v-for="s in data.contributions.promptSections" :key="s.name" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ s.description || s.name }}</span>
                <div class="flex flex-wrap items-center gap-1 mt-0.5">
                  <GdTag v-if="s.toolkitId" size="small" type="info" effect="plain">{{ s.toolkitId }}</GdTag>
                  <GdTag v-if="s.scope === 'agent'" size="small" type="info" effect="plain">
                    {{ t('plugins.localTools.detail.scopeAgent') }}
                  </GdTag>
                  <GdTag v-if="s.visibleTo?.length" size="small" type="primary" effect="plain">
                    {{ t('plugins.localTools.detail.visibleToTag') }}
                  </GdTag>
                  <GdTag v-if="s.complete" size="small" type="warning" effect="plain">
                    {{ t('plugins.localTools.detail.completeTag') }}
                  </GdTag>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 工具：工具包 + 工具 -->
        <section v-if="data.counts.toolkits > 0 || data.counts.tools > 0" class="pd-section">
          <div class="pd-section-head">
            <Wrench16Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.tools') }}</span>
            <GdTag v-if="data.counts.toolkits > 0" size="small" type="info" effect="plain">
              {{ t('plugins.localTools.detail.toolkitCount', { count: data.counts.toolkits }) }}
            </GdTag>
            <GdTag size="small" type="info" effect="plain">
              {{ t('plugins.localTools.detail.toolCount', { count: data.counts.tools }) }}
            </GdTag>
          </div>
          <div v-if="data.counts.toolkits > 0" class="pd-list mb-1.5">
            <div v-for="k in data.contributions.toolkits" :key="k.id" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ k.name || k.id }}</span>
                <span v-if="k.description" class="pd-desc">{{ k.description }}</span>
              </div>
              <span class="pd-meta">
                {{ t('plugins.localTools.detail.kitMeta', { tools: k.toolCount || 0, prompts: k.promptCount || 0 }) }}
              </span>
            </div>
          </div>
          <div v-if="data.counts.tools > 0" class="pd-list">
            <div v-for="tool in data.contributions.tools" :key="tool.name" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ tool.name }}</span>
                <span v-if="tool.description" class="pd-desc pd-ellipsis">{{ tool.description }}</span>
              </div>
              <span v-if="tool.toolkitId" class="pd-meta">{{ tool.toolkitId }}</span>
            </div>
          </div>
        </section>

        <!-- 界面：主题 / 插槽 / 设置页 / 附件类型 / 连接类型 -->
        <section v-if="interfaceCount > 0" class="pd-section">
          <div class="pd-section-head">
            <Color20Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.interface') }}</span>
            <GdTag size="small" type="info" effect="plain">{{ interfaceCount }}</GdTag>
          </div>
          <div v-if="data.counts.themes > 0" class="pd-list mb-1.5">
            <div v-for="th in data.contributions.themes" :key="th.id" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ th.name || th.id }}</span>
                <div class="flex items-center gap-1 mt-0.5">
                  <span v-if="th.primaryColor" class="pd-swatch" :style="{ backgroundColor: th.primaryColor }" />
                  <GdTag size="small" type="info" effect="plain">{{ th.mode || 'all' }}</GdTag>
                  <GdTag v-if="th.rich" size="small" type="primary" effect="plain">
                    {{ t('plugins.localTools.detail.richTheme') }}
                  </GdTag>
                </div>
              </div>
            </div>
          </div>
          <div v-if="data.counts.slots > 0" class="pd-list mb-1.5">
            <div v-for="(slot, i) in data.contributions.slots" :key="`${slot.name}-${slot.component}-${i}`" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ slot.label || slot.component }}</span>
                <span class="pd-desc">{{ slot.name }}</span>
              </div>
            </div>
          </div>
          <div v-if="data.counts.uiPages > 0" class="pd-list mb-1.5">
            <div v-for="p in data.contributions.uiPages" :key="p.id" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ p.tab || p.id }}</span>
                <span class="pd-desc">{{ p.group }}</span>
              </div>
            </div>
          </div>
          <div v-if="data.counts.attachmentTypes > 0" class="pd-list mb-1.5">
            <div v-for="a in data.contributions.attachmentTypes" :key="a.id" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ a.label || a.id }}</span>
              </div>
            </div>
          </div>
          <div v-if="data.counts.workspaceProviders > 0" class="pd-list">
            <div v-for="w in data.contributions.workspaceProviders" :key="w.scheme" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ w.label || w.scheme }}</span>
                <span class="pd-desc">{{ w.scheme }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 命令 -->
        <section v-if="data.counts.localCommands > 0" class="pd-section">
          <div class="pd-section-head">
            <Apps20Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.commands') }}</span>
            <GdTag size="small" type="info" effect="plain">{{ data.counts.localCommands }}</GdTag>
          </div>
          <div class="pd-list">
            <div v-for="c in data.contributions.localCommands" :key="c.name" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">/{{ c.name }}</span>
                <span v-if="c.description" class="pd-desc">{{ c.description }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 扩展接口（默认折叠） -->
        <section v-if="advancedCount > 0" class="pd-section">
          <button type="button" class="pd-section-head w-full text-left" @click="advancedOpen = !advancedOpen">
            <Code16Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.advanced') }}</span>
            <GdTag size="small" type="info" effect="plain">{{ advancedCount }}</GdTag>
            <ChevronRight16Regular class="pd-chevron" :class="{ 'pd-chevron-open': advancedOpen }" />
          </button>
          <div v-show="advancedOpen" class="space-y-2 mt-1.5">
            <div v-for="group in advancedGroups" :key="group.key">
              <div class="pd-subtitle">{{ group.label }}</div>
              <div class="pd-list">
                <div v-for="(row, i) in group.rows" :key="i" class="pd-row">
                  <span class="pd-name pd-mono">{{ row }}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 供应商能力 -->
        <section v-if="data.counts.providerTypes > 0 || data.counts.providerProtocols > 0" class="pd-section">
          <div class="pd-section-head">
            <PuzzleCube20Regular class="pd-section-icon" />
            <span>{{ t('plugins.localTools.detail.provider') }}</span>
            <GdTag size="small" type="info" effect="plain">
              {{ data.counts.providerTypes + data.counts.providerProtocols }}
            </GdTag>
          </div>
          <div class="pd-list">
            <div v-for="t in data.contributions.providerTypes" :key="t.type" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ t.name || t.type }}</span>
                <span class="pd-desc">{{ t.protocol }}</span>
              </div>
              <span class="pd-meta">{{ t.modelCount || 0 }} models</span>
            </div>
            <div v-for="p in data.contributions.providerProtocols" :key="p.protocol" class="pd-row">
              <div class="pd-row-main">
                <span class="pd-name">{{ p.displayName || p.protocol }}</span>
                <span class="pd-desc">{{ p.protocol }}</span>
              </div>
              <GdTag v-if="p.active === false" size="small" type="warning" effect="plain">
                {{ t('plugins.localTools.detail.providerInactive') }}
              </GdTag>
            </div>
          </div>
        </section>
      </template>

      <!-- 降级：贡献接口失败时回退到 query 的基础工具列表 -->
      <div v-else class="space-y-2">
        <p class="text-xs text-amber-600 dark:text-amber-400">{{ t('plugins.localTools.detail.loadFailed') }}</p>
        <div v-if="plugin?.tools?.length" class="pd-list">
          <div v-for="sub in plugin.tools" :key="sub.name" class="pd-row">
            <div class="pd-row-main">
              <span class="pd-name">{{ sub.name }}</span>
              <span v-if="sub.description" class="pd-desc">{{ sub.description }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <GdButton v-if="plugin?.configSchema?.fields?.length" type="primary" @click="emit('open-config')">
        {{ t('plugins.config.open') }}
      </GdButton>
      <GdButton @click="emit('update:visible', false)">{{ t('common.close') }}</GdButton>
    </template>
  </GdDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import GdDialog from '@/components/ui/GdDialog.vue'
import GdTag from '@/components/ui/GdTag.vue'
import GdButton from '@/components/ui/GdButton.vue'
import GdAlert from '@/components/ui/GdAlert.vue'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import {
  ArrowSync16Regular,
  Bot20Regular,
  BookOpen20Regular,
  TextDescription20Regular,
  Wrench16Regular,
  Color20Regular,
  Apps20Regular,
  Code16Regular,
  ChevronRight16Regular,
  PuzzleCube20Regular,
} from '@vicons/fluent'
import { apiService } from '@/services/ApiService'
import { getLocale } from '@/locales'
import { resolvePluginIconUrl } from '@/utils/pluginIcon'
import type { PluginContributions, PluginQueryPlugin } from '@/services/modules/settings.api'

/**
 * 插件详情弹窗（v4.1）
 *
 * 完整展示一个插件的各类贡献（智能体/技能/提示词/工具/界面/命令/扩展接口/供应商），
 * 只到摘要级：名称 + 一行描述 + 数量，不展示工具 parameters / 提示词正文。
 * 数据来自 GET /plugins/:pluginId/contributions；失败时降级到列表已有的 tools 数据。
 */
const props = defineProps<{
  visible: boolean
  plugin: PluginQueryPlugin | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'open-config': []
}>()

const { t } = useI18n()

const data = ref<PluginContributions | null>(null)
const loading = ref(false)
const failed = ref(false)
const advancedOpen = ref(false)

const pluginId = computed(() => props.plugin?.pluginId || '')
const iconSrc = computed(() =>
  pluginId.value ? resolvePluginIconUrl(pluginId.value, props.plugin?.iconRev) : null,
)
const displayName = computed(() => props.plugin?.displayName || pluginId.value)
const description = computed(
  () => data.value?.manifest?.description || props.plugin?.description || '',
)

/** 概览芯片：类别计数（只显示 > 0） */
const overviewChips = computed(() => {
  const c = data.value?.counts
  if (!c) return []
  const items: Array<{ key: keyof typeof c; label: string }> = [
    { key: 'toolkits', label: t('plugins.localTools.detail.chipToolkits') },
    { key: 'tools', label: t('plugins.localTools.detail.chipTools') },
    { key: 'promptSections', label: t('plugins.localTools.detail.chipPrompts') },
    { key: 'skills', label: t('plugins.localTools.detail.chipSkills') },
    { key: 'agents', label: t('plugins.localTools.detail.chipAgents') },
    { key: 'themes', label: t('plugins.localTools.detail.chipThemes') },
    { key: 'localCommands', label: t('plugins.localTools.detail.chipCommands') },
  ]
  const extra =
    (c.slots || 0) + (c.uiPages || 0) + (c.attachmentTypes || 0) + (c.workspaceProviders || 0)
  if (extra > 0) items.push({ key: 'slots', label: t('plugins.localTools.detail.chipInterface') })
  if ((c.providerTypes || 0) + (c.providerProtocols || 0) > 0) {
    items.push({ key: 'providerTypes', label: t('plugins.localTools.detail.chipProvider') })
  }
  // key 仅用于 v-for；count 取真实值（界面芯片用合计）
  return items
    .map((item) => ({
      ...item,
      count:
        item.key === 'slots'
          ? extra
          : item.key === 'providerTypes'
            ? (c.providerTypes || 0) + (c.providerProtocols || 0)
            : c[item.key] || 0,
    }))
    .filter((item) => item.count > 0)
})

const interfaceCount = computed(() => {
  const c = data.value?.counts
  if (!c) return 0
  return (c.themes || 0) + (c.slots || 0) + (c.uiPages || 0) + (c.attachmentTypes || 0) + (c.workspaceProviders || 0)
})

const advancedCount = computed(() => {
  const c = data.value?.counts
  if (!c) return 0
  return (c.httpRoutes || 0) + (c.rpcMethods || 0) + (c.hooks || 0) + (c.turnReminders || 0) + (c.promptTransforms || 0)
})

/** 扩展接口分组（开发者向，默认折叠） */
const advancedGroups = computed(() => {
  const ct = data.value?.contributions
  if (!ct) return []
  return [
    {
      key: 'httpRoutes',
      label: t('plugins.localTools.detail.httpRoutes'),
      rows: ct.httpRoutes.map((r) => `${r.method} ${r.path}`),
    },
    { key: 'rpcMethods', label: t('plugins.localTools.detail.rpcMethods'), rows: ct.rpcMethods },
    {
      key: 'hooks',
      label: t('plugins.localTools.detail.hooks'),
      rows: ct.hooks.map((h) => `${h.event}${h.order !== undefined ? ` (#${h.order})` : ''}`),
    },
    {
      key: 'turnReminders',
      label: t('plugins.localTools.detail.turnReminders'),
      rows: ct.turnReminders.map((r) => `${r.id}${r.order !== undefined ? ` (#${r.order})` : ''}`),
    },
    {
      key: 'promptTransforms',
      label: t('plugins.localTools.detail.promptTransforms'),
      rows: ct.promptTransforms.map((p) => `${p.id}${p.order !== undefined ? ` (#${p.order})` : ''}`),
    },
  ].filter((g) => g.rows.length > 0)
})

async function load(pluginId: string) {
  data.value = null
  failed.value = false
  advancedOpen.value = false
  if (!pluginId) return
  loading.value = true
  try {
    data.value = await apiService.fetchPluginContributions(pluginId, getLocale())
  } catch (err) {
    console.warn('[PluginDetailDialog] contributions failed:', err)
    failed.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, pluginId.value] as const,
  ([visible, id]) => {
    if (visible && id) void load(id)
  },
  { immediate: true },
)
</script>

<style scoped>
.pd-section {
  border-top: 1px solid transparent;
}

.pd-section-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--gd-color-text);
  margin-bottom: 0.375rem;
}

.pd-section-icon {
  width: 1rem;
  height: 1rem;
  color: var(--gd-color-text-gray);
  flex-shrink: 0;
}

.pd-chevron {
  margin-left: auto;
  width: 1rem;
  height: 1rem;
  color: var(--gd-color-text-gray);
  transition: transform 0.15s ease;
}

.pd-chevron-open {
  transform: rotate(90deg);
}

.pd-subtitle {
  font-size: 0.6875rem;
  color: var(--gd-color-text-gray);
  margin-bottom: 0.25rem;
}

.pd-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 14rem;
  overflow-y: auto;
}

.pd-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  border-radius: var(--gd-size-surface-radius);
  background: rgba(0, 0, 0, 0.03);
}

:global(.dark) .pd-row {
  background: #2a2a2e;
}

.pd-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pd-name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--gd-color-text);
  word-break: break-all;
}

.pd-desc {
  font-size: 0.6875rem;
  color: var(--gd-color-text-gray);
  line-height: 1.4;
}

.pd-ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pd-meta {
  font-size: 0.6875rem;
  color: var(--gd-color-text-gray);
  flex-shrink: 0;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pd-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
}

.pd-swatch {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 9999px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  display: inline-block;
  flex-shrink: 0;
}
</style>
