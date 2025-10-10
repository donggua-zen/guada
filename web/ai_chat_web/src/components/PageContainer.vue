<template>
  <div class="page-container">
    <ChatPage v-if="activePage === 'chat'" />
    <CharactersPage v-if="activePage === 'characters'" />
    <SettingsPage v-if="activePage === 'settings'" />
  </div>
</template>

<script setup>
import ChatPage from './ChatPage.vue'
import CharactersPage from './CharactersPage.vue'
// import SettingsPage from './SettingsPage.vue'

defineProps({
  activePage: String
})
</script>