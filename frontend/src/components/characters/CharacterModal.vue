<template>
    <el-dialog v-model="visible" :close-on-click-modal="false" width="900px"
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
    </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElDialog, ElButton } from 'element-plus'
import CharacterSettingPanel from './CharacterSettingPanel.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '@/composables/usePopup'

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

.dialog-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}
</style>

<style>
/* 非 scoped 样式，直接作用于 el-dialog__body */
.character-setting-dialog .el-dialog__body {
    display: flex !important;
    flex-direction: column !important;
    flex: 1;
    min-height: 0;
    padding: 0 !important;
    overflow: hidden;
}

.character-setting-dialog .el-dialog {
    display: flex;
    flex-direction: column;
}
</style>
