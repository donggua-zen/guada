<template>
    <img v-if="src" :src="avatarSrc" alt="Avatar" class="avatar-image w-full h-full"
        :style="{ borderRadius: props.round ? '50%' : '0' }"></img>
    <div v-else class="avatar-placeholder" :style="{ borderRadius: props.round ? '50%' : '0' }">
        <UserOutlined v-if="props.type === 'user'" />
        <OpenAI v-else />
    </div>

</template>
<script setup>
import { computed } from 'vue'
import {
    UserOutlined,
} from '@vicons/antd'
import { OpenAI } from '@/components/icons'
const props = defineProps({
    src: {
        type: String,
        default: ''
    },
    round: {
        type: Boolean,
        default: false
    },
    type: {
        type: String,
        default: 'assistant'
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
    // const separator = props.src.includes('?') ? '&' : '?'
    return '/'+props.src
    return props.src
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
    /* border: 1px solid #d0d0d0; */
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f5f5f5;
    color: #999;
    overflow: hidden;
}
</style>