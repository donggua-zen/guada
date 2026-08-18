/**
 * 插件 UI 入口：加载 SFC 组件并注册到模块加载器
 *
 * 构建时（vite lib mode IIFE）：
 *  - vue 被 external → 产物通过 rollup globals 从 window.__GuaDaShared__.vue 取
 *  - 本文件调用 window.__GuaDaModuleLoader__.register 注册组件
 */
import MyPanel from './MyPanel.vue'

window.__GuaDaModuleLoader__.register('demo-settings:MyPanel', { default: MyPanel })
