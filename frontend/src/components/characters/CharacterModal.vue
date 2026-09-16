<template>
    <GdDialog v-model="visible" :close-on-click-modal="false" width="900px"
        :style="{ height: '70vh', maxWidth: '90vw' }" class="character-setting-dialog" destroy-on-close append-to-body>
        <template #header>
            <div class="dialog-header">
                <span class="dialog-title">{{ currentCharacter?.id ? t('characters.modal.editTitle') : t('characters.modal.createTitle') }}</span>
            </div>
        </template>

        <div class="dialog-content">
            <CharacterSettingPanel ref="settingPanelRef" :data="currentCharacter" :is-new="!props.characterId" :simple="false" class="flex-1" />
        </div>

        <template #footer>
            <el-button @click="handleClose">{{ t('common.cancel') }}</el-button>
            <el-button type="primary" @click="handleSave" :loading="saving" :disabled="!panelHasChanges">{{ t('characters.modal.applyAll') }}</el-button>
        </template>
    </GdDialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElButton } from 'element-plus'
import CharacterSettingPanel from './CharacterSettingPanel.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '@/composables/usePopup'
import GdDialog from '@/components/ui/GdDialog.vue'

const { toast } = usePopup()
const { t } = useI18n()

// Props
const props = defineProps<{
    show?: boolean;
    characterId?: string;
}>()

// Emits
const emit = defineEmits<{
    'saved': [character: any]
    'update:show': [show: boolean]
}>()

// 响应式数据
const visible = ref(false)
const saving = ref(false)
const currentCharacter = ref<any>({})
const settingPanelRef = ref<InstanceType<typeof CharacterSettingPanel> | null>(null)
const panelHasChanges = ref(true)

// 监听显示状态
watch(() => props.show, (newVal) => {
    visible.value = newVal
}, { immediate: true })

// 对话框每次打开：清空旧数据 + 重新 fetch（统一入口，避免重复请求）
watch(visible, async (newVal) => {
    if (!newVal) {
        emit('update:show', false)
        return
    }
    currentCharacter.value = {};
    if (props.characterId) {
        try {
            currentCharacter.value = await apiService.fetchCharacter(props.characterId);
        } catch (error) {
            console.error("[CharacterModal] Failed to fetch character:", error);
            currentCharacter.value = {};
        }
    }
})

// 关闭弹窗
const handleClose = (): void => {
    visible.value = false
}

// 同步子组件表单变更状态
watch(() => settingPanelRef.value, (instance) => {
    if (!instance) return;
    watch(() => instance.hasChanges, (val) => {
        panelHasChanges.value = val
    }, { immediate: true })
}, { immediate: true })

// 保存逻辑
const handleSave = async (): Promise<void> => {
    // 触发子组件的验证与数据获取
    if (!settingPanelRef.value) return;

    const isValid = await settingPanelRef.value.validate();
    if (!isValid) return;

    saving.value = true;
    try {
        const data = settingPanelRef.value.getFormData();
        let character: any = null;
        const { avatarFile, avatarUrl: _avatarUrl, ...characterData } = data;

        if (currentCharacter.value && currentCharacter.value.id) {
            const response = await apiService.updateCharacter(currentCharacter.value.id, characterData);
            character = response;
        } else {
            const response = await apiService.createCharacter(characterData);
            character = response;
        }

        if (character && avatarFile) {
            const response = await apiService.uploadAvatar(character['id'], avatarFile);
            character.avatarUrl = response.url;
            settingPanelRef.value.clearAvatarFile();
        }

        if (character) {
            currentCharacter.value = character;
        }

        toast.success(t('characters.modal.saveSuccess'));
        emit('saved', currentCharacter.value);
        visible.value = false;
    } catch (error) {
        console.error("角色保存失败:", error);
        toast.error(t('characters.modal.saveFailed'));
    } finally {
        saving.value = false;
    }
}
</script>

<style scoped>
.dialog-header {
    display: flex;
    align-items: center;
    width: 100%;
}

.dialog-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
}

/* GdDialog 的 .l-dialog__body 是普通 block 容器，flex 属性在此不生效；
   必须用百分比高度撑满它（.l-dialog 有确定的 70vh），面板才能拿到确定高度，
   否则内容溢出会由 body 滚动，左侧导航跟着一起滚。 */
.dialog-content {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
}
</style>

<style>
/* GdDialog scoped styles handle dialog body/header.
   本对话框内容自带内边距（面板侧栏 py-3、各 tab px-4 py-6），
   body 的 12px 顶部内边距是纯叠加，会让标题栏与内容之间留白过大 → 仅去掉顶部。
   character-setting-dialog 类名仅本组件使用，故用全局选择器（Teleport 内容上
   没有本组件的 scope id，scoped :deep 选不中 .l-dialog__body）。 */
.l-dialog.character-setting-dialog .l-dialog__body {
    padding-top: 0;
}
</style>
