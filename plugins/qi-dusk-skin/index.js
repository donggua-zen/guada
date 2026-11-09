"use strict";

/**
 * 柒·残月都市 —— 独立主题皮肤插件（外置）
 *
 * 从 guada-themes 内置主题插件迁出（2026-11-07）：主题带 3 张原始 PNG 立绘/背景
 * （~6MB，定稿后转 webp），不适合打进安装包，故按第三方皮肤形态独立分发。
 *
 * ## 形态说明
 *
 * - 开发期：本目录位于仓库 plugins/ 下 = PLUGINS_DEV_DIR（electron/main.ts:1143），
 *   后端作为外部插件自动加载；
 * - 打包应用内安装：把整个 qi-dusk-skin/ 目录放进用户插件目录
 *   （Electron userData/plugins），或经插件市场安装；
 * - 主题 id 沿用迁移前的 "qi-dusk"：用户设置里已持久化的 darkThemePreset 无缝衔接，
 *   不需要重新选择。官方约定第三方主题 id 建议 `${pluginId}.${name}`，
 *   这里因与内置版互斥迁移（内置注册已同时移除）而保持短 id。
 *
 * ## 契约
 *
 * 与 guada-themes 相同：CommonJS 纯 JS 零依赖入口，`cssFile` 为相对插件根的
 * 受约束路径，CSS 内相对 url() 以 CSS 文件位置为基准解析（themes/img/…），
 * 资源自包含于本目录，由后端 /plugins/:pluginId/assets 端点服务。
 * `ownsBackground: true`：主题接管背景层——宿主暂存并清空用户壁纸，
 * 主题卸载时自动还原（theme-runtime.ts）。
 */

/** @type {Array<{id: string, name: string, primaryColor?: string, secondaryColor?: string, mode?: "light"|"dark"|"all", ownsBackground?: boolean}>} */
const THEMES = [
  {
    id: "qi-dusk",
    name: "柒·残月都市",
    primaryColor: "#b13440",
    secondaryColor: "#565c66",
    mode: "all",
    ownsBackground: true,
  },
];

class QiDuskSkinPlugin {
  constructor() {
    this.manifest = {
      id: "qi-dusk-skin",
      name: "柒·残月都市（皮肤）",
      version: "1.0.0",
      description: "原创 IP「柒」主题皮肤：全窗背景 + 左右立绘 + 半透明装甲面板（亮暗通用）",
      category: "user",
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
        ownsBackground: t.ownsBackground,
        cssFile: `themes/${t.id}.css`,
      });
    }
  }
}

module.exports = QiDuskSkinPlugin;
module.exports.default = QiDuskSkinPlugin;
