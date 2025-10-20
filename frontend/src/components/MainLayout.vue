<template>
    <div class="app-main-container">
        <Sidebar :active-page="activePage" @change-page="changePage" />
        <div class="page-container">
            <RouterView></RouterView>
        </div>
    </div>
</template>
<script setup>
import { useRouter } from 'vue-router'
import Sidebar from '../components/Sidebar.vue' 
const router = useRouter()

const changePage = (page) => {
    switch (page) {
        case 'Chat':
            router.replace({ name: 'Chat' })
            break
        case 'Characters':
            router.replace({ name: 'Characters' })
            break
        case 'Settings':
            // router.replace({ name: 'settings' })
            break
    }
}
</script>