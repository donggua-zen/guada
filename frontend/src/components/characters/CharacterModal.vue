<template>
    <el-dialog v-model="visible" :close-on-click-modal="false" width="700px"
        :style="{ minHeight: '65vh', maxHeight: '85vh', maxWidth: '85vw' }" class="character-setting-dialog" destroy-on-close>
        <template #header>
            <div class="dialog-header">
                <span class="dialog-title">{{ currentCharacter?.id ? '编辑角色' : '新建角色' }}</span>
            </div>
        </template>

        <div class="dialog-content">
            <CharacterSettingPanel ref="settingPanelRef" :data="currentCharacter" :simple="false" class="flex-1" />
        </div>

        <template #footer>
            <el-button @click="handleClose">取消</el-button>
            <el-button type="primary" @click="handleSave" :loading="saving">应用全部设置</el-button>
        </template>
    </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElDialog, ElButton } from 'element-plus'
import CharacterSettingPanel from './CharacterSettingPanel.vue'
import { apiService } from '../../services/ApiService'
import { usePopup } from '@/composables/usePopup'

const { toast } = usePopup()

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
const settingPanelRef = ref<any>(null)

// 监听显示状态
watch(() => props.show, (newVal) => {
    visible.value = newVal
}, { immediate: true })

watch(visible, (newVal) => {
    if (!newVal) {
        emit('update:show', false)
    }
})

// 监听角色 ID 变化并加载数据
watch(() => props.characterId, async (newVal) => {
    if (newVal) {
        try {
            currentCharacter.value = await apiService.fetchCharacter(newVal);
        } catch (error) {
            console.error("[CharacterModal] Failed to fetch character:", error);
            currentCharacter.value = {};
        }
    } else {
        currentCharacter.value = {};
    }
}, { immediate: true })

// 关闭弹窗
const handleClose = (): void => {
    visible.value = false
}

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
        let characterData = { ...data };
        const avatarFile = data.avatarFile;

        delete characterData.avatarFile;
        delete characterData.avatarUrl;

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

        toast.success("角色更新成功");
        emit('saved', currentCharacter.value);
        visible.value = false;
    } catch (error) {
        console.error("角色保存失败:", error);
        toast.error("角色保存失败");
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
    height: 100%; /* 确保有明确高度，让子组件的 flex: 1 生效 */
}
</style>
