<template>
  <div class="app-main-container">
    <Sidebar :active-page="activePage" @change-page="changePage" />
    <PageContainer :active-page="activePage" />
    <!-- <ModalContainer /> -->
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Sidebar from './components/Sidebar.vue'
import PageContainer from './components/PageContainer.vue'
// import ModalContainer from './components/ModalContainer.vue'

const activePage = ref('chat')

const changePage = (page) => {
  activePage.value = page
}
</script>

<style>
 /* 新增侧边栏样式 */
        .app-sidebar {
            width: 60px;
            background-color: #2c3e50;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px 0;
            height: 100vh;
        }

        .sidebar-btn {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 15px;
            cursor: pointer;
            color: #bdc3c7;
            font-size: 20px;
            transition: all 0.2s ease;
        }

        .sidebar-btn:hover {
            background-color: #34495e;
            color: #ecf0f1;
        }

        .sidebar-btn.active {
            background-color: #3498db;
            color: white;
        }

        /* 页面容器样式 */
        .page-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        .page {
            display: none;
            width: 100%;
            height: 100%;
        }

        .page.active {
            display: flex;
        }

        /* 调整原有布局 */
        .app-main-container {
            display: flex;
            height: 100vh;
            width: 100vw;
        }
</style>