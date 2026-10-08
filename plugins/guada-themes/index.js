"use strict";

/**
 * GuaDa 官方内置主题插件
 *
 * 迁移自 frontend/public/themes/*.css（2026-09-02），并作为「插件注册主题」的参考范例。
 *
 * ## 为什么入口是纯 JS、且不 import 任何模块
 *
 * 本插件**随安装包分发**（electron-builder extraResources → resources/plugins/，
 * 由 PLUGINS_BUILTIN_DIR 指向），生产后端以 `node dist/main` 运行：
 * - 没有 TS loader：`.ts` 入口在生产 require 不了；
 * - 插件的相对 import（如 ../../backend-ts/src/modules/plugins）在打包后不存在（只有 dist）。
 *
 * 因此入口用 CommonJS 纯 JS、零依赖：插件类只要提供 `manifest` 与 `onLoad(api)` 即可，
 * 不强制继承 PluginBase（loader 明确支持「CommonJS 直出类」）。第三方插件照此结构即可。
 *
 * ## 契约（assets 端点，见 plugins.controller.ts getPluginAsset）
 *
 * - `cssFile` 为**相对插件根**的受约束路径（如 `themes/cyberpunk.css`），可含单层子路径；
 *   扩展名限 css/js/字体/图片（字符白名单，杜绝目录穿越）；
 * - 资源自包含于插件目录：CSS 内相对 url() 以 CSS 文件位置为基准解析
 *   （如 famicom 字体位于 themes/fonts/）；
 * - 主题 id 全局唯一，且**沿用原内置 id**（用户 localStorage/设置里的持久化值无缝衔接）；
 *   第三方建议 `${pluginId}.${name}`；
 * - category=system：默认启用且不可禁用（plugin.manager.ts），也**不允许卸载**
 *   （plugins.controller.ts：source=builtin 拒绝卸载）——主题不会因禁用而丢失。
 */

/** @type {Array<{id: string, name: string, primaryColor?: string, secondaryColor?: string, mode?: "light"|"dark"|"all"}>} */
const THEMES = [
  { id: "brutalist", name: "粗野主义", primaryColor: "#141414", secondaryColor: "#ffcf00" },
  { id: "blueprint", name: "工程蓝图", primaryColor: "#2060b0", secondaryColor: "#0e8fa8" },
  { id: "steampunk", name: "蒸汽朋克", primaryColor: "#a55e28", secondaryColor: "#3e7d6f" },
  { id: "y2k", name: "千禧铬彩", primaryColor: "#6673f0", secondaryColor: "#e854ae" },
  { id: "pop-comic", name: "波普漫画", primaryColor: "#ee2233", secondaryColor: "#1f6fff" },
  { id: "famicom", name: "红白机", primaryColor: "#c8102e", secondaryColor: "#f0b400" },
  { id: "e-ink", name: "墨水屏", primaryColor: "#3a3a3a", secondaryColor: "#8a8578" },
  { id: "doodle", name: "涂鸦本", primaryColor: "#3a7bd5", secondaryColor: "#e8854a" },
  {
    id: "cyberpunk",
    name: "赛博朋克（仅暗色）",
    primaryColor: "#00e5ff",
    secondaryColor: "#ff2a6d",
    mode: "dark",
  },
  {
    id: "wandering-earth",
    name: "小破球（仅暗色）",
    primaryColor: "#d99a4e",
    secondaryColor: "#43b581",
    mode: "dark",
  },
  {
    id: "winxp",
    name: "视窗 XP（仅亮色）",
    primaryColor: "#0058e6",
    secondaryColor: "#3a9b3a",
    mode: "light",
  },
];

class GuadaThemesPlugin {
  constructor() {
    this.manifest = {
      id: "guada-themes",
      name: "GuaDa 内置主题",
      version: "1.1.0",
      description: "官方内置主题插件（由 frontend/public/themes 迁移），插件注册主题参考范例",
      category: "system",
    };
  }

  /**
   * @param {{ registerTheme: (t: object) => void }} api
   */
  async onLoad(api) {
    for (const t of THEMES) {
      api.registerTheme({
        id: t.id,
        name: t.name,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
        mode: t.mode,
        cssFile: `themes/${t.id}.css`,
      });
    }
  }
}

module.exports = GuadaThemesPlugin;
module.exports.default = GuadaThemesPlugin;
