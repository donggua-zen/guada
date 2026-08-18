/**
 * 插件 UI 原语全局注册
 *
 * 目的：插件产物是运行时加载的 IIFE，其模板里的 <GdXxx> 编译成
 * resolveComponent('GdXxx') 运行时解析——必须在这里显式全局注册，
 * 否则插件无法使用 Gd 原语组件。
 *
 * 原语契约：插件只依赖"组件名 + props + --gd-* token"，不感知内部实现。
 * 将来换 UI 方案（替换 ElementPlus 内部实现）只改这里 import 的组件内部，插件零改动。
 */
import { App } from "vue";
import GdButton from "./GdButton.vue";
import GdDialog from "./GdDialog.vue";
import GdTooltip from "./GdTooltip.vue";
import GdPopover from "./GdPopover.vue";
import GdPane from "./GdPane.vue";
import GdSplitpanes from "./GdSplitpanes.vue";

export function registerUiPrimitives(app: App): void {
  app.component("GdButton", GdButton);
  app.component("GdDialog", GdDialog);
  app.component("GdTooltip", GdTooltip);
  app.component("GdPopover", GdPopover);
  app.component("GdPane", GdPane);
  app.component("GdSplitpanes", GdSplitpanes);
}