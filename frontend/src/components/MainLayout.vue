<template>
    <div class="app-main-container">
        <Sidebar @change-page="changePage" @open-settings="handleOpenSettings" />
        <div class="page-container">
            <RouterView></RouterView>
        </div>
    </div>
    <GlobaSettingModal v-model:visible="visible" @update:data="saveGlobalSetting" :data="globaSettings" />
</template>
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import GlobaSettingModal from '@/components/GlobaSettingModal.vue'
const router = useRouter()
const visible = ref(false)
const globaSettings = ref({})
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

const handleOpenSettings = () => {
    visible.value = true
}

const saveGlobalSetting = (data) => {
    globaSettings.value = data
}
</script>