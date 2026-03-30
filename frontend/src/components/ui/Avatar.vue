<template>
    <img v-if="src" :src="avatarSrc" alt="Avatar" class="avatar-image w-full h-full"
        :class="{ 'rounded-full': props.round, 'rounded-lg': !props.round }"></img>
    <div v-else class="avatar-placeholder" :class="{
        'rounded-full': props.round,
        'rounded-lg': !props.round, 'avatar-user': props.type === 'user'
    }">
        <UserOutlined v-if="props.type === 'user'" class="w-[65%] h-[65%]" />
        <OpenAI v-else />
    </div>

</template>
<script setup lang="ts">
import { computed } from 'vue'
// @ts-ignore - icons 类型缺失
import {
    UserOutlined,
} from '@vicons/antd'
// @ts-ignore - icons 类型缺失
import { OpenAI } from '@/components/icons'

// Props 类型化
const props = defineProps<{
    src?: string;
    round?: boolean;
    type?: 'user' | 'assistant';
    full?: boolean;
}>();
// 添加时间戳避免缓存 - 类型化
const avatarSrc = computed((): string => {
    if (!props.src) return ''
    // 如果已经是 blob URL 或者是 base64，直接返回
    if (props.src.startsWith('blob:') || props.src.startsWith('data:')) {
        return props.src
    }
    // 添加时间戳参数避免缓存
    // const separator = props.src.includes('?') ? '&' : '?'
    return '/' + props.src
    // return props.src
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

.avatar-placeholder.avatar-user {
    background-color: #999;
    color: #fff;
}
</style>