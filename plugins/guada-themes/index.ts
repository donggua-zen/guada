import { PluginBase, type PluginApi } from "../../backend-ts/src/modules/plugins";

/**
 * GuaDa 官方内置主题插件
 *
 * 迁移自 frontend/public/themes/*.css（2026-09-02）。同时作为「插件注册主题」
 * 的参考范例：第三方插件复制本文件结构即可——在 onLoad 里调用
 * api.registerTheme({ id, name, cssFile, primaryColor, secondaryColor, mode })，
 * 并将主题 CSS 放在插件 frontend/dist/ 下。
 *
 * 约束（assets 端点契约，见 plugins.controller.ts getPluginAsset）：
 * - cssFile 为相对插件 frontend/dist 的**扁平文件名**（仅 [A-Za-z0-9_-]+\.css，
 *   不支持子目录/路径分隔符；font/图片等资源不被该端点服务）；
 * - 因此主题 CSS 必须**自包含**：url() 只用 data: URI 或绝对 URL——相对路径
 *   会以文档位置为基准解析而失效。本例 famicom 字体已内联为 data: URI。
 * - id 全局唯一（沿用原内置 id，保证用户 localStorage 持久化设置无缝衔接；
 *   第三方建议 `${pluginId}.${name}`）。
 * - category=system：默认启用且不可禁用（plugin.manager.ts:116,341），
 *   避免主题因插件被禁用而丢失。
 */
export default class GuadaThemesPlugin extends PluginBase {
  manifest = {
    id: "guada-themes",
    name: "GuaDa 内置主题",
    version: "1.0.0",
    description: "官方内置主题插件（由 frontend/public/themes 迁移），插件注册主题参考范例",
    category: "system" as const,
  };

  async onLoad(api: PluginApi) {
    const themes: Array<{
      id: string;
      name: string;
      primaryColor?: string;
      secondaryColor?: string;
      mode?: "light" | "dark" | "all";
    }> = [
      { id: "brutalist", name: "粗野主义", primaryColor: "#141414", secondaryColor: "#ffcf00" },
      { id: "blueprint", name: "工程蓝图", primaryColor: "#2060b0", secondaryColor: "#0e8fa8" },
      { id: "steampunk", name: "蒸汽朋克", primaryColor: "#a55e28", secondaryColor: "#3e7d6f" },
      { id: "y2k", name: "千禧铬彩", primaryColor: "#6673f0", secondaryColor: "#e854ae" },
      { id: "pop-comic", name: "波普漫画", primaryColor: "#ee2233", secondaryColor: "#1f6fff" },
      { id: "famicom", name: "红白机", primaryColor: "#c8102e", secondaryColor: "#f0b400" },
      { id: "e-ink", name: "墨水屏", primaryColor: "#3a3a3a", secondaryColor: "#8a8578" },
      { id: "doodle", name: "涂鸦本", primaryColor: "#3a7bd5", secondaryColor: "#e8854a" },
      { id: "cyberpunk", name: "赛博朋克（仅暗色）", primaryColor: "#00e5ff", secondaryColor: "#ff2a6d", mode: "dark" },
      { id: "wandering-earth", name: "小破球（仅暗色）", primaryColor: "#d99a4e", secondaryColor: "#43b581", mode: "dark" },
    ];

    for (const t of themes) {
      api.registerTheme({
        id: t.id,
        name: t.name,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
        mode: t.mode,
        cssFile: `${t.id}.css`,
      });
    }
  }
}
