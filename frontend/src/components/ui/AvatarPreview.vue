<template>
    <div class="avatar-upload-container flex flex-col items-center justify-center">
        <div class="avatar-preview w-25 h-25 cursor-pointer" @click="triggerAvatarUpload">
            <Avatar :src="previewUrl" :type="type"></Avatar>
        </div>
        <div class="avatar-upload-actions mt-3">
            <UiButton @click="triggerAvatarUpload" round :border="false" plain type="primary" size="small">
                <template #icon>
                    <FileUploadOutlined />
                </template>
                更换头像
            </UiButton>
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
                <UiButton @click="closeCropModal">取消</UiButton>
                <UiButton type="primary" @click="cropAvatar">确认裁剪</UiButton>
            </div>
        </template>
    </el-dialog>
</template>
<script setup>
import { ref, onMounted, onUnmounted, computed, watch, } from 'vue'
import Avatar from './Avatar.vue'
import UiButton from './UiButton.vue'
import { Cropper } from 'vue-advanced-cropper'
import 'vue-advanced-cropper/dist/style.css'
import { ElDialog } from 'element-plus'

import {
    FileUploadOutlined,
} from '@vicons/material'

const showCropModal = ref(false)
const cropImageSrc = ref('')
const cropFile = ref(null)
const cropperAvatar = ref(null)
const avatarInput = ref(null)
const previewUrl = ref('')

const emits = defineEmits(['avatar-changed'])

const props = defineProps({
    src: {
        type: String,
        default: () => ({})
    },
    type: {
        type: String,
        default: 'user'
    }
})

watch(() => props.src, (newValue) => {
    if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl.value);
    }
    previewUrl.value = newValue
})

const triggerAvatarUpload = () => {
    avatarInput.value.click()
}
const closeCropModal = () => {
    showCropModal.value = false
    cropImageSrc.value = ''
    cropFile.value = null
}
const cropAvatar = () => {
    if (!cropperAvatar.value) return

    const { canvas } = cropperAvatar.value.getResult()

    canvas.toBlob((blob) => {
        // 创建新文件对象
        const croppedFile = new File([blob], cropFile.value.name, {
            type: cropFile.value.type,
        })

        // 创建预览URL
        if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl.value);
        }
        previewUrl.value = URL.createObjectURL(croppedFile)
        emits('avatar-changed', croppedFile)
        closeCropModal()
    }, cropFile.value.type, 0.9)
}
const handleAvatarChanged = (event) => {
    const file = event.target.files[0]
    if (file) {
        if (!file.type.startsWith('image/')) {
            toast.error('请选择图片文件')
            return
        }

        if (file.size > 5 * 1024 * 1024) {
            toast.error('图片大小不能超过5MB')
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            cropImageSrc.value = e.target.result
            cropFile.value = file
            showCropModal.value = true
        }
        reader.readAsDataURL(file)
    }

    // 清空input，允许重复选择同一文件
    event.target.value = ''
}
onUnmounted(() => {
    if (previewUrl.value && previewUrl.value.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl.value);
        previewUrl.value = ''
    }
});
</script>