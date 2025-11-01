<template>
    <img v-if="src" :src="avatarSrc" alt="Avatar" class="avatar-image w-full h-full"
        :style="{ borderRadius: props.round ? '50%' : '0' }"></img>
    <div v-else class="avatar-placeholder" :style="{ borderRadius: props.round ? '50%' : '0' }">
        <UserOutlined />
    </div>

</template>
<script setup>
import { computed } from 'vue'
import {
    UserOutlined,
} from '@vicons/antd'
const props = defineProps({
    src: {
        type: String,
        default: ''
    },
    round: {
        type: Boolean,
        default: false
    }
});
// 添加时间戳避免缓存
const avatarSrc = computed(() => {
    if (!props.src) return ''
    // 如果已经是blob URL或者是base64，直接返回
    if (props.src.startsWith('blob:') || props.src.startsWith('data:')) {
        return props.src
    }
    // 添加时间戳参数避免缓存
    const separator = props.src.includes('?') ? '&' : '?'
    return props.src + separator + 't=' + new Date().getTime()
});

</script>
<style scoped>
.avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.avatar-placeholder {
    width: 100%;
    height: 100%;
    border: 2px dashed #d0d0d0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f5f5f5;
    color: #999;
}
</style>