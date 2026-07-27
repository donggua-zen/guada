<template>
  <img :src="iconUrl" alt="" style="width: 1em; height: 1em; object-fit: contain;" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { fixFrontendAssetUrl } from '@/utils/url';

const iconUrl = computed(() => fixFrontendAssetUrl('/images/windows-explorer.png'));
</script>
