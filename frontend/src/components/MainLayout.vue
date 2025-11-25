<template>
    <div class="app-main-container">
        <Sidebar @change-page="changePage" />
        <div class="page-container">
            <RouterView></RouterView>
        </div>
    </div>
    <!-- <GlobaSettingModal v-model:visible="visible" /> -->
</template>
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import GlobaSettingModal from '@/components/GlobaSettingModal.vue'
const router = useRouter()
const visible = ref(true)

const changePage = (page) => {
    switch (page) {
        case 'Chat':
            router.replace({ name: 'Chat' })
            break
        case 'Characters':
            router.replace({ name: 'Characters' })
            break
        case 'Models':
            router.replace({ name: 'Models' })
            break
    }
}
</script>