/**
 * 主题注册表与加载器（v3：主题 = 皮肤）
 *
 * 统一模型：
 * - 纯 CSS 主题：只给 cssFile/cssFiles，靠 `html[data-theme=x]` 变量覆盖；
 * - 富主题（原「皮肤」）：额外带 runtimeScript/assetBase/bodyAttribute/settings，
 *   由 `services/theme-runtime` 统一应用（body 作用域 + 资源 + 自建 DOM + 可还原）。
 *
 * 关键点：
 * - themePresets 是响应式数组，插件注册/移除后设置下拉自动更新；
 * - applyThemePreset 对"未知主题 id"（清单尚未到达的插件主题）不发起加载，
 *   记录为 pending，待注册表变化（retryPendingTheme）后补应用；
 * - 切换防闪烁：新 CSS onload 后再移除旧 CSS（由 theme-runtime 负责）。
 */

import { reactive } from "vue";
import {
  applyTheme,
  removeTheme,
  activeThemeId,
  notifyThemeSetting,
  isRichTheme,
  themeAssetUrl,
  type ThemeManifest,
} from "@/services/theme-runtime";

export { isRichTheme, themeAssetUrl, notifyThemeSetting };
export type { ThemeManifest };

import { isMobileDevice } from "@/composables/useDevice";

export interface ThemePresetInfo {
  id: string;
  name: string;
  /** i18n key for theme name (built-in themes only); external plugins use `name` directly */
  nameKey?: string;
  /** 主色，用于下拉圆点预览 */
  primaryColor: string;
  /** 副色，用于下拉圆点预览 */
  secondaryColor: string;
  /** 适用模式：'light' / 'dark' / 'all'（默认 all） */
  mode?: "light" | "dark" | "all";
  /** 插件主题专用：所属插件 ID（用于卸载/禁用时按插件移除） */
  pluginId?: string;
  /** 插件主题专用：CSS 文件（相对插件根） */
  cssFile?: string;
  /** 插件主题专用：亮/暗分文件 */
  cssFiles?: { light?: string; dark?: string };
  /** 富主题字段（原「皮肤」） */
  runtimeScript?: string;
  assetBase?: string;
  bodyAttribute?: string;
  settings?: ThemeManifest["settings"];
  preview?: { light?: string; dark?: string };
  ownsBackground?: boolean;
  recommendedThemes?: string[];
  rev?: string;
}

/**
 * 内置主题注册表。
 * default 无 CSS；magpie 为静态内置浅色主题，CSS 位于 frontend/public/themes/
 * （经 getThemeCssUrl 的 fallback 路径加载）。其余主题已迁移至
 * plugins/guada-themes，由插件注册下发——id 与原内置一致，用户持久化设置无缝衔接。
 */
const builtinThemes: ThemePresetInfo[] = [
  {
    id: "default",
    name: "默认",
    nameKey: "common.theme.default",
    primaryColor: "#fb7299",
    secondaryColor: "#5b8def",
  },
  {
    id: "magpie",
    name: "喜鹊",
    nameKey: "common.theme.magpie",
    primaryColor: "#1c1c21",
    secondaryColor: "#4f46e5",
    mode: "light",
  },
];

/**
 * 主题注册表（响应式）。
 * 内置主题常驻；插件主题由 registerExternalTheme / removeThemesByPlugin 增删。
 */
export const themePresets: ThemePresetInfo[] = reactive([...builtinThemes]);

/** 注册版本号：注册/移除时自增，useTheme 据此补应用 pending 主题 */
export const themeRegistryVersion = reactive({ value: 0 });

/** 插件注册的外部 CSS URL（id → 完整 URL，含 rev 查询参数） */
const externalThemeUrls: Record<string, string> = {};

/** 尚未就绪的待应用主题（清单未到达时记录，注册表变化后补应用） */
let pendingPresetId: string | null = null;

/**
 * 注册新主题（单条，兼容旧入口）
 * @param info 主题信息
 * @param cssUrl 主题 CSS 文件 URL（不传则从 public/themes/{id}.css 加载）
 */
export function registerTheme(info: ThemePresetInfo, cssUrl?: string): void {
  registerExternalTheme(info, cssUrl);
}

/**
 * 注册插件主题（幂等：同 id 覆盖；同插件其余主题保留）
 * @param info 主题信息（含 pluginId/cssFile）
 * @param cssUrl 主题 CSS 完整 URL（插件主题由 pluginSlots 拼 assets 地址）
 */
export function registerExternalTheme(info: ThemePresetInfo, cssUrl?: string): void {
  if (cssUrl) externalThemeUrls[info.id] = cssUrl;
  const idx = themePresets.findIndex((t) => t.id === info.id);
  if (idx >= 0) {
    // 更新已有注册（如 rev 变化后的 URL 更新），保留原顺序
    themePresets[idx] = { ...themePresets[idx], ...info };
  } else {
    themePresets.push(info);
  }
  themeRegistryVersion.value++;
  // 若正是 pending 的主题，立即补应用
  if (pendingPresetId === info.id) {
    pendingPresetId = null;
    applyThemePreset(info.id);
  }
}

/**
 * 按插件移除其注册的所有主题（插件禁用/卸载时调用）
 * @returns 被移除的主题 id 列表
 */
export function removeThemesByPlugin(pluginId: string): string[] {
  const removed: string[] = [];
  for (let i = themePresets.length - 1; i >= 0; i--) {
    if (themePresets[i].pluginId === pluginId) {
      removed.push(themePresets[i].id);
      delete externalThemeUrls[themePresets[i].id];
      themePresets.splice(i, 1);
    }
  }
  if (removed.length) {
    themeRegistryVersion.value++;
    if (pendingPresetId && removed.includes(pendingPresetId)) {
      pendingPresetId = null;
    }
  }
  return removed;
}

/**
 * 全量替换某插件的主题注册（applySlots 语义：后端清单为准）
 */
export function replaceThemesByPlugin(
  pluginId: string,
  list: Array<{ info: ThemePresetInfo; cssUrl: string }>,
): void {
  removeThemesByPlugin(pluginId);
  for (const { info, cssUrl } of list) {
    externalThemeUrls[info.id] = cssUrl;
    themePresets.push({ ...info, pluginId });
  }
  if (list.length) {
    themeRegistryVersion.value++;
    // 若正是 pending 的主题（启动时持久化 id 先于清单到达），立即补应用，
    // 确保挂载前/窗口显示前主题 CSS link 已插入，避免首帧主题闪烁
    if (pendingPresetId && list.some(({ info }) => info.id === pendingPresetId)) {
      const id = pendingPresetId;
      pendingPresetId = null;
      applyThemePreset(id);
    }
  }
}

/**
 * 获取主题 CSS URL
 * 插件主题走 externalThemeUrls（pluginSlots 按 apiService.baseURL 拼 assets
 * 地址）；静态内置主题（magpie）与历史兜底走 public/themes/{id}.css——
 * dev 由 vite public 目录直出，Electron 生产经 base:'./' + loadFile 相对解析。
 */
function getThemeCssUrl(themeId: string): string {
  if (externalThemeUrls[themeId]) return externalThemeUrls[themeId];
  return `${import.meta.env.BASE_URL}themes/${themeId}.css`;
}

/** 当前已应用的预设 id（与 DOM/运行时状态一致） */
let appliedPresetId: string | null = null;

/**
 * 应用主题预设（纯 CSS 或富主题统一入口）
 *
 * 未知主题 id（插件清单尚未到达）→ 记录 pending，不发起加载。
 *
 * 移动端：预设主题一律不生效（移动端布局极端，皮肤的面板/立绘/切角
 * 无法适配），只保留基础 token 的亮/暗响应（html.dark 与主题预设无关）。
 * 持久化层（localStorage / 后端 appearance）照常记录用户选择，
 * 回到桌面端无缝恢复；守卫必须放在幂等检查之前——否则桌面端已应用
 * qi-dusk 后切到移动端，幂等短路会跳过卸载，皮肤残留在移动页面上。
 */
export function applyThemePreset(presetId: string): void {
  if (isMobileDevice) {
    if (appliedPresetId === "default") return;
    appliedPresetId = "default";
    pendingPresetId = presetId === "default" ? null : presetId;
    removeTheme();
    document.documentElement.removeAttribute("data-theme");
    return;
  }

  // 幂等：与当前已应用主题相同则跳过（避免重复请求）
  if (appliedPresetId === presetId && activeThemeId() === presetId) return;
  if (appliedPresetId === presetId && presetId === "default") return;

  // 未知主题：置 pending，等注册表变化后补应用（retryPendingTheme）
  const preset = getThemePreset(presetId);
  if (!preset) {
    pendingPresetId = presetId;
    return;
  }

  appliedPresetId = presetId;

  // default 主题：无 CSS，卸载富主题并清除 data-theme
  if (presetId === "default") {
    removeTheme();
    document.documentElement.removeAttribute("data-theme");
    return;
  }

  const manifest: ThemeManifest = {
    pluginId: preset.pluginId || "",
    id: preset.id,
    name: preset.name,
    primaryColor: preset.primaryColor,
    secondaryColor: preset.secondaryColor,
    mode: preset.mode,
    cssFile: preset.cssFile,
    cssFiles: preset.cssFiles,
    runtimeScript: preset.runtimeScript,
    assetBase: preset.assetBase,
    bodyAttribute: preset.bodyAttribute,
    settings: preset.settings,
    preview: preset.preview,
    ownsBackground: preset.ownsBackground,
    recommendedThemes: preset.recommendedThemes,
    rev: preset.rev,
    cssUrl: getThemeCssUrl(presetId),
  };

  // 富主题：设置值来自 plugin:<id> 数据（异步读取，读不到就用默认值）
  if (isRichTheme(manifest) && preset.pluginId) {
    void loadThemeSettings(preset.pluginId)
      .then((values) => applyTheme(manifest, values))
      .catch((error) => {
        console.warn("[themes] load theme settings failed, applying with defaults", error);
        void applyTheme(manifest, {});
      });
    return;
  }

  void applyTheme(manifest, {});
}

/** 动态读取插件数据，避免 themes 模块强依赖 apiService（破坏测试/启动顺序） */
async function loadThemeSettings(pluginId: string): Promise<Record<string, unknown>> {
  const shared = (window as any).__GuaDaShared__;
  const api = shared?.pluginApi;
  if (!api?.getPluginData) return {};
  try {
    return (await api.getPluginData(pluginId)) || {};
  } catch {
    return {};
  }
}

/**
 * 补应用 pending 主题（注册表变化后由 useTheme 调用）
 * @returns 是否发生了补应用
 */
export function retryPendingTheme(): boolean {
  if (!pendingPresetId) return false;
  if (!getThemePreset(pendingPresetId)) return false;
  const id = pendingPresetId;
  pendingPresetId = null;
  applyThemePreset(id);
  return true;
}

/** 当前 pending 的待应用主题 id（调试用） */
export function getPendingPresetId(): string | null {
  return pendingPresetId;
}

/** 重置内部状态（主要供测试/热重载场景） */
export function _resetThemeState(): void {
  appliedPresetId = null;
  pendingPresetId = null;
  removeTheme();
}

/**
 * 获取主题信息
 */
export function getThemePreset(id: string): ThemePresetInfo | undefined {
  return themePresets.find((t) => t.id === id);
}
