<template>
    <el-dialog v-model="visible" :close-on-click-modal="false" style="width: 600px;max-width: 90vw;"
        title="角色设置">
        <div class="max-h-80vh overflow-y-auto">
            <CharacterSettingPanel :data="currentCharacter" @update:data="handleSave" :simple="true" />
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

// 抽屉宽度响应式
const drawerWidth = ref<number | string>(600)



// 响应式调整抽屉宽度
const updateDrawerWidth = (): void => {
    const width = window.innerWidth
    if (width < 768) {
        drawerWidth.value = '90%'
    } else if (width < 1200) {
        drawerWidth.value = 400
    } else {
        drawerWidth.value = 400
    }
}

// 监听props.show变化
watch(() => props.show, (newVal) => {
    visible.value = newVal
    if (newVal) {
        // 重置表单数据
        // Object.assign(characterForm, props.character)
        // 更新抽屉宽度
        updateDrawerWidth()
    }
}, { immediate: true })

// 监听visible变化
watch(visible, (newVal) => {
    if (!newVal) {
        emit('update:show', false)
    }
})

watch(() => props.characterId, async (newVal) => {
    console.log("watching characterId");
    console.log(newVal);
    if (newVal) {
        currentCharacter.value = await apiService.fetchCharacter(newVal);
    }
    else {
        currentCharacter.value = {};
    }
}, { immediate: true })

// 生命周期
onMounted(() => {
    window.addEventListener('resize', updateDrawerWidth)
})

onUnmounted(() => {
    window.removeEventListener('resize', updateDrawerWidth)
})

// 方法 - 类型化
const handleClose = (): void => {
    visible.value = false
}

const handleSave = async (data: any): Promise<void> => {
    console.log("handleSave called");
    console.log(data);
    let character: any = null;
    try {
        // console.log(characterForm);
        if (currentCharacter.value && currentCharacter.value.id) {
            const response = await apiService.updateCharacter(currentCharacter.value.id, data);
            character = { id: currentCharacter.value.id, ...data };
            // toast.success("角色更新成功");
        } else {
            const response = await apiService.createCharacter(data);
            character = response;
        }
        if (character && data.avatar_file) {
            const response = await apiService.uploadAvatar(character['id'], data.avatar_file);
            character.avatar_url = response.url + "?v=" + new Date().getTime();
            character.avatar_file = null;
        }
        if (character) {
            currentCharacter.value = character;
        }
        toast.success("角色更新成功");
    } catch (error) {
        toast.error("角色保存失败");
    }
    emit('saved', currentCharacter.value);
    visible.value = false;
}
</script>

<style scoped>
.drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

.drawer-content {
    /* height: calc(100vh - 140px); */
    overflow-y: auto;
    padding: 0 4px;
}

.drawer-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 16px;
}




/* 修改 .drawer-content 的高度计算 */
.drawer-content {
    /* height: calc(100vh - 180px); */
    /* 调整这个值 */
    /* overflow-y: auto; */
    padding: 0 4px;
}
</style>
