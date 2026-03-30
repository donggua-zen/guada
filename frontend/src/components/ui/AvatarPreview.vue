<template>
    <div class="avatar-upload-container flex flex-col items-center justify-center">
        <div class="avatar-preview w-25 h-25 cursor-pointer" @click="triggerAvatarUpload">
            <Avatar :src="previewUrl" :type="type"></Avatar>
        </div>
        <div class="avatar-upload-actions mt-3">
            <el-button @click="triggerAvatarUpload" round :border="false" plain type="primary" size="small">
                <template #icon>
                    <FileUploadOutlined />
                </template>
                更换头像
            </el-button>
        </div>
        <input ref="avatarInput" type="file" accept="image/*" style="display: none" @change="handleAvatarChanged">
    </div>
    <!-- 头像裁剪模态框 -->
    <el-dialog v-model="showCropModal" title="裁剪头像" width="600px">
        <div class="modal-body">
            <cropper ref="cropperAvatar" :src="cropImageSrc" :stencil-props="{
                aspectRatio: 1,
                movable: true,
                resizable: true
            }" :resize-image="{
                adjustStencil: false
            }" :output-type="'png'" :output-size="{ width: 500, height: 500 }" />
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <el-button @click="closeCropModal">取消</el-button>
                <el-button type="primary" @click="cropAvatar">确认裁剪</el-button>
            </div>
        </template>
    </el-dialog>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import Avatar from './Avatar.vue'
// @ts-ignore - Element Plus 类型缺失
import { ElButton, ElDialog } from 'element-plus'
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
// @ts-ignore - icons 类型缺失
import {
    FileUploadOutlined,
} from '@vicons/material'

const showCropModal = ref(false)
const cropImageSrc = ref('')
const cropFile = ref<File | null>(null)
const cropperAvatar = ref<any>(null)
const avatarInput = ref<HTMLInputElement | null>(null)
const previewUrl = ref('')

// Emits 类型化
const emits = defineEmits<{
    'avatar-changed': [file: File]
}>()

// Props 类型化
const props = defineProps<{
    src?: string;
    type?: 'user' | 'assistant';
}>()

// 监听 src 变化 - 类型化
watch(() => props.src, (newValue: string | undefined) => {
    if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl.value);
    }
    previewUrl.value = newValue || ''
})

// 触发头像上传 - 类型化
const triggerAvatarUpload = (): void => {
    avatarInput.value?.click?.()
}

// 关闭裁剪模态框 - 类型化
const closeCropModal = (): void => {
    showCropModal.value = false
    cropImageSrc.value = ''
    cropFile.value = null
}

// 裁剪头像 - 类型化
const cropAvatar = (): void => {
    if (!cropperAvatar.value || !cropFile.value) return

    const { canvas } = cropperAvatar.value.getResult()

    canvas.toBlob((blob: Blob | null) => {
        if (!blob) return
        
        // 创建新文件对象 - 使用非空断言
        const croppedFile = new File([blob], cropFile.value!.name, {
            type: cropFile.value!.type,
        })

        // 创建预览 URL
        if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl.value);
        }
        previewUrl.value = URL.createObjectURL(croppedFile)
        emits('avatar-changed', croppedFile)
        closeCropModal()
    }, cropFile.value.type, 0.9)
}

// 处理头像改变 - 类型化
const handleAvatarChanged = (event: Event): void => {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    if (file) {
        if (!file.type.startsWith('image/')) {
            // @ts-ignore - toast 未迁移
            toast.error('请选择图片文件')
            return
        }

        if (file.size > 5 * 1024 * 1024) {
            // @ts-ignore - toast 未迁移
            toast.error('图片大小不能超过 5MB')
            return
        }

        const reader = new FileReader()
        reader.onload = (e: ProgressEvent<FileReader>) => {
            cropImageSrc.value = e.target?.result as string
            cropFile.value = file
            showCropModal.value = true
        }
        reader.readAsDataURL(file)
    }

    // 清空 input，允许重复选择同一文件
    target.value = ''
}
// 组件卸载时清理资源 - 类型化
onUnmounted(() => {
    if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = ''
    }
});
</script>