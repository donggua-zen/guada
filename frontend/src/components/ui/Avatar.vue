<template>
    <img v-if="src" :src="avatarSrc" alt="Avatar" class="avatar-image w-full h-full"
        :class="{ 'rounded-full': props.round, 'rounded-lg': !props.round }"></img>
    <div v-else class="avatar-placeholder" :class="{
        'rounded-full': props.round,
        'rounded-lg': !props.round, 'avatar-user': props.type === 'user'
    }">
        <!-- 如果有名称且是 assistant 类型，显示首字 -->
        <span v-if="name && props.type === 'assistant'" class="avatar-text">
            {{ firstChar }}
        </span>
        <UserOutlined v-else-if="props.type === 'user'" class="w-[65%] h-[65%]" />
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
    name?: string;  // 用于生成首字头像的名称
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
    if (props.src.startsWith('/'))
        return props.src
    if (props.src.startsWith('http'))
        return props.src
    return '/' + props.src
    // return props.src
});

// 获取名称的第一个字符 - 类型化
const firstChar = computed((): string => {
    if (!props.name) return ''
    // 去除空格后取第一个字符
    const trimmed = props.name.trim()
    return trimmed ? trimmed.charAt(0) : ''
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
    color: #666;
    overflow: hidden;
    container-type: size;
}

.dark .avatar-placeholder {
    background-color: #374151;
    color: #d1d5db;
}

.avatar-placeholder.avatar-user {
    background-color: #999;
    color: #fff;
}

.avatar-text {
    font-size: 60cqw;
    font-weight: 600;
    color: #444;
    line-height: 1;
}

.dark .avatar-text {
    color: #e5e7eb;
}
</style>