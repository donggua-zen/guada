// src/components/ui/index.ts
// UI 组件统一导出

// 同步导出所有 UI 组件
export { default as ChatInput } from '../chat/ChatInput.vue'
export { default as FileItem } from './FileItem.vue'
export { default as ScrollContainer } from './ScrollContainer.vue'
export { default as ScrollToBottomButton } from './ScrollToBottomButton.vue'
export { default as SidebarLayout } from './SidebarLayout.vue'
export { default as AvatarPreview } from './AvatarPreview.vue'
export { default as Avatar } from './Avatar.vue'
export { default as GdButton } from './GdButton.vue'
export { default as GdDialog } from './GdDialog.vue'
export { default as GdDialogHost } from './GdDialogHost.vue'
export { default as GdSliderOptional } from './GdSliderOptional.vue'
export { default as SegmentedToggle } from './SegmentedToggle.vue'
export { default as MarkdownContent } from './MarkdownContent.vue'
export { default as GdSplitpanes } from './GdSplitpanes.vue'
export { default as GdPane } from './GdPane.vue'
export { default as GdInput } from './GdInput.vue'
export { default as GdSwitch } from './GdSwitch.vue'
export { default as GdSelect } from './GdSelect.vue'
export { default as GdInputNumber } from './GdInputNumber.vue'
export { default as GdSlider } from './GdSlider.vue'
export { default as GdTag } from './GdTag.vue'
export { default as GdAlert } from './GdAlert.vue'
export { default as GdProgress } from './GdProgress.vue'
export { default as GdDivider } from './GdDivider.vue'
export { default as GdEmpty } from './GdEmpty.vue'
export { default as GdCheckbox } from './GdCheckbox.vue'
export { default as GdCheckboxGroup } from './GdCheckboxGroup.vue'
export { default as GdSegmented } from './GdSegmented.vue'
export { default as GdRadio } from './GdRadio.vue'
export { default as GdRadioGroup } from './GdRadioGroup.vue'
export { default as GdFormField } from './GdFormField.vue'
export { default as GdTabs } from './GdTabs.vue'
export { default as GdPagination } from './GdPagination.vue'
export { default as GdCollapse } from './GdCollapse.vue'
export { default as GdImageViewer } from './GdImageViewer.vue'
export { default as GdDrawer } from './GdDrawer.vue'
export { default as GdDatePicker } from './GdDatePicker.vue'
export { default as GdTimePicker } from './GdTimePicker.vue'

// 异步组件版本，用于路由级别或条件渲染
// import { defineAsyncComponent, DefineComponent } from 'vue'

// export const AsyncChatInput = defineAsyncComponent(() => import('../chat/ChatInput.vue'))
// export const AsyncFileItem = defineAsyncComponent(() => import('./FileItem.vue'))
// export const AsyncScrollContainer = defineAsyncComponent(() => import('./ScrollContainer.vue'))
// export const AsyncSidebarLayout = defineAsyncComponent(() => import('./SidebarLayout.vue'))
// export const AsyncAvatarPreview = defineAsyncComponent(() => import('./AvatarPreview.vue'))
// export const AsyncAvatar = defineAsyncComponent(() => import('./Avatar.vue'))
// export const AsyncGdButton = defineAsyncComponent(() => import('./GdButton.vue'))