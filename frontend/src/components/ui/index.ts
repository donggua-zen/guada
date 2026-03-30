// src/components/ui/index.ts
// UI 组件统一导出

// 同步导出所有 UI 组件
export { default as ChatInput } from './ChatInput.vue'
export { default as FileItem } from './FileItem.vue'
export { default as ScrollContainer } from './ScrollContainer.vue'
export { default as ScrollToBottomButton } from './ScrollToBottomButton.vue'
export { default as SidebarLayout } from './SidebarLayout.vue'
export { default as AvatarPreview } from './AvatarPreview.vue'
export { default as Avatar } from './Avatar.vue'
export { default as UiButton } from './UiButton.vue'
export { default as ElSliderOptional } from './ElSliderOptional.vue'

// 异步组件版本，用于路由级别或条件渲染
// import { defineAsyncComponent, DefineComponent } from 'vue'

// export const AsyncChatInput = defineAsyncComponent(() => import('./ChatInput.vue'))
// export const AsyncFileItem = defineAsyncComponent(() => import('./FileItem.vue'))
// export const AsyncScrollContainer = defineAsyncComponent(() => import('./ScrollContainer.vue'))
// export const AsyncSidebarLayout = defineAsyncComponent(() => import('./SidebarLayout.vue'))
// export const AsyncAvatarPreview = defineAsyncComponent(() => import('./AvatarPreview.vue'))
// export const AsyncAvatar = defineAsyncComponent(() => import('./Avatar.vue'))
// export const AsyncUiButton = defineAsyncComponent(() => import('./UiButton.vue'))