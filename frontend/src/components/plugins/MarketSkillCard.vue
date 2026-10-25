<template>
    <div
        class="market-card flex cursor-pointer flex-col gap-2 rounded-[var(--gd-size-surface-radius)] border border-(--gd-color-surface-border) bg-(--gd-color-surface-subtle) p-4 hover:bg-(--gd-color-surface-subtle-hover)"
        @click="emit('click')"
    >
        <!-- 头部：图标 + 名称/版本 + 状态徽标 -->
        <div class="flex items-center gap-3">
            <CardAvatar :src="skill.icon" :name="skill.name" size="lg" />
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-semibold text-gray-900 dark:text-[#e8e9ed]">{{ skill.name }}</span>
                    <span v-if="skill.version" class="shrink-0 text-xs text-gray-400">v{{ skill.version }}</span>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-1">
                    <el-tag v-if="skill.localStatus === 'installed'" type="success" size="small" effect="plain">{{ t('plugins.skills.marketInstalled') }}</el-tag>
                    <el-tag v-else-if="skill.localStatus === 'updatable'" type="warning" size="small" effect="plain">{{ t('plugins.skills.marketUpdatable') }}</el-tag>
                    <el-tag v-if="skill.lang !== skill.requestedLang" type="info" size="small" effect="plain">{{ t('plugins.skills.marketFallbackHint') }}</el-tag>
                    <el-tag v-for="(label, index) in (skill.labels || []).slice(0, 2)" :key="`${label.id}-${index}`" size="small" effect="light">
                        {{ label.name }}
                    </el-tag>
                </div>
            </div>
        </div>

        <!-- 描述：两行截断 -->
        <p class="market-card__desc text-xs leading-relaxed text-gray-500 dark:text-[#8b8d95]">
            {{ skill.description || t('plugins.skills.noDescription') }}
        </p>

        <!-- 底部：安装按钮 -->
        <div class="mt-auto flex justify-end pt-1">
            <el-button
                size="small"
                :type="skill.localStatus === 'updatable' ? 'warning' : 'primary'"
                :loading="installing"
                @click.stop="emit('install')"
            >
                {{ buttonLabel }}
            </el-button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CardAvatar from '@/components/ui/CardAvatar.vue'
import type { MarketSkillWithStatus } from '@/services/SkillMarketService'

const props = defineProps<{
    skill: MarketSkillWithStatus
    installing?: boolean
}>()

const emit = defineEmits<{
    click: []
    install: []
}>()

const { t } = useI18n()

const buttonLabel = computed(() => {
    switch (props.skill.localStatus) {
        case 'updatable': return t('plugins.skills.marketUpgradeBtn')
        case 'installed': return t('plugins.skills.marketReinstallBtn')
        default: return t('plugins.skills.marketInstallBtn')
    }
})
</script>

<style scoped>
.market-card__desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
}
</style>
