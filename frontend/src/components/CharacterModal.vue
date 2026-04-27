<template>
    <el-dialog 
        v-model="visible" 
        :close-on-click-modal="false" 
        width="800px"
        :style="{ maxHeight: '75vh' }"
        class="character-setting-dialog"
        destroy-on-close
    >
        <template #header>
            <div class="dialog-header">
                <span class="dialog-title">{{ currentCharacter?.id ? '编辑角色' : '新建角色' }}</span>
            </div>
        </template>
        
        <div class="dialog-content">
            <CharacterSettingPanel 
                ref="settingPanelRef"
                :data="currentCharacter" 
                @update:data="handleSave" 
                :simple="false" 
            />
        </div>
    </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted, onUnmounted } from 'vue'
import {
    ElDialog
} from 'element-plus'
import CharacterSettingPanel from './CharacterSettingPanel.vue'
import { apiService } from '../services/ApiService'
import { usePopup } from '@/composables/usePopup'

const { toast } = usePopup()

// Props - 类型化
const props = defineProps<{
    show?: boolean;
    mode?: string;
    characterId?: string;
}>()

// Emits - 类型化
const emit = defineEmits<{
    'update:data': [data: any]
    'saved': [character: any]
    'update:show': [show: boolean]
}>()

// 响应式数据 - 类型化
const visible = ref(false)
const loading = ref(false)
const currentCharacter = ref<any>({})
const settingPanelRef = ref<any>(null)





// 监听props.show变化
watch(() => props.show, (newVal) => {
    visible.value = newVal
}, { immediate: true })

// 监听visible变化
watch(visible, (newVal) => {
    if (!newVal) {
        emit('update:show', false)
    }
})

watch(() => props.characterId, async (newVal) => {
    if (newVal) {
        try {
            currentCharacter.value = await apiService.fetchCharacter(newVal);
        } catch (error) {
            console.error("[CharacterModal] Failed to fetch character:", error);
            currentCharacter.value = {};
        }
    }
    else {
        currentCharacter.value = {};
    }
}, { immediate: true })

// 生命周期
onMounted(() => {
    // 无需额外初始化
})

// 方法 - 类型化
const handleClose = (): void => {
    visible.value = false
}

const handleSave = async (data: any): Promise<void> => {
    let character: any = null;
    let characterData = { ...data };
    const avatarFile = data.avatarFile; // 先缓存引用
    
    // 从提交数据中移除 avatarFile，避免后端报错
    delete characterData.avatarFile;
    delete characterData.avatarUrl; // 修改不应该携带头像数据
    
    try {
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
            
            // 上传成功后清除子组件的 avatarFile，避免重复上传
            if (settingPanelRef.value) {
                settingPanelRef.value.clearAvatarFile();
            }
        }
        if (character) {
            currentCharacter.value = character;
        }
        toast.success("角色更新成功");
    } catch (error) {
        console.error("角色保存失败:", error);
        toast.error("角色保存失败");
    }
    emit('saved', currentCharacter.value);
    visible.value = false;
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
    height: calc(75vh - 120px);
    overflow-y: auto;
    padding: 0 4px;
}

/* 优化弹窗样式 */
.character-setting-dialog :deep(.el-dialog__body) {
    padding: 0;
    height: calc(75vh - 60px);
    overflow: hidden;
}

.character-setting-dialog :deep(.el-dialog__header) {
    margin-right: 0;
    padding: 16px 20px;
    border-bottom: 1px solid var(--el-border-color-light);
}

.character-setting-dialog :deep(.el-dialog__footer) {
    padding: 0;
}

/* 滚动条美化 */
.dialog-content::-webkit-scrollbar {
    width: 6px;
}

.dialog-content::-webkit-scrollbar-track {
    background: transparent;
}

.dialog-content::-webkit-scrollbar-thumb {
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
}

.dark .dialog-content::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
}
</style>
