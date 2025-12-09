<template>
    <div class="flex flex-col h-screen w-screen">
        <div class="h-15 border-b border-gray-200 flex items-center px-4">
            <div class="h-7.5 cursor-pointer" @click="router.push({ name: 'Home' })">
                <img src="/images/logo.png" alt="logo" class="h-full" />
            </div>
            <div class="flex-1"></div>
            <div class="w-10 h-10 cursor-pointer" @click="router.push({ name: 'My' })">
                <Avatar type="user" :round="true" :src="authStore.user.avatar_url" />
            </div>
        </div>
        <div class="min-h-0 flex-1 flex">
            <Sidebar @change-page="changePage" @open-settings="handleOpenSettings" v-if="needSidebar" />
            <div class="h-full w-full min-h-0 flex-1 flex overflow-hidden">
                <RouterView></RouterView>
            </div>
        </div>
    </div>
    <GlobaSettingModal v-model:visible="visible" @update:data="saveGlobalSetting" :data="globaSettings" />
</template>
<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import GlobaSettingModal from '@/components/GlobaSettingModal.vue'
import { Avatar } from './ui'
import { useAuthStore } from '../stores/auth'
import { computed } from 'vue'

const router = useRouter()
const route = useRoute()
const visible = ref(false)
const globaSettings = ref({})
const authStore = useAuthStore()
const changePage = (page) => {
    switch (page) {
        case 'Chat':
            router.push({ name: 'Chat' })
            break
        case 'Characters':
            router.push({ name: 'Characters' })
            break
        case 'Models':
            router.push({ name: 'Models' })
            break
        case 'My':
            router.push({ name: 'My' })
            break
    }
}

const needSidebar = computed(() => {
    return route.name !== 'My'
})

const handleOpenSettings = () => {
    visible.value = true
}

const saveGlobalSetting = (data) => {
    globaSettings.value = data
}
</script>