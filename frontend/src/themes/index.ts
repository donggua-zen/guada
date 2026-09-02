/**
 * 主题注册表与加载器
 *
 * 内置主题仅保留 default（无 CSS）；其余 10 个主题已迁移为插件注册
 * （plugins/guada-themes，category=system），由 pluginSlots 消费后端
 * themes 清单后经 registerExternalTheme / replaceThemesByPlugin 注册，
 * CSS 走插件 assets 端点（http(s)://.../plugins/:id/assets/:file.css）。
 *
 * 关键点：
 * - themePresets 是响应式数组（reactive），插件注册/移除后设置下拉自动更新；
 * - applyThemePreset 对"未知主题 id"（清单尚未到达的插件主题）不发起加载，
 *   记录为 pending，待注册表变化（retryPendingTheme）后补应用；
 * - 切换防闪烁：新 CSS onload 后再移除旧 CSS，避免闪白。
 */

import { reactive } from "vue";

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
  /** 插件主题专用：CSS 文件名（相对插件 frontend/dist，由 pluginSlots 拼完整 URL） */
  cssFile?: string;
}

/**
 * 内置主题注册表（仅 default）。
 * 其余主题（brutalist/blueprint/steampunk/y2k/pop-comic/famicom/e-ink/
 * doodle/cyberpunk/wandering-earth）已迁移至 plugins/guada-themes，
 * 由插件注册下发——id 与原内置一致，用户持久化设置无缝衔接。
 */
const builtinThemes: ThemePresetInfo[] = [
  {
    id: "default",
    name: "默认",
    nameKey: "common.theme.default",
    primaryColor: "#fb7299",
    secondaryColor: "#5b8def",
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
 * 主题（除 default）均由插件注册，externalThemeUrls 必有值（pluginSlots
 * 按 apiService.baseURL 拼 assets 地址）；fallback 保留仅为兜底，
 * 正常路径不可达（未知 id 在 applyThemePreset 已置 pending 拦截）。
 */
function getThemeCssUrl(themeId: string): string {
  if (externalThemeUrls[themeId]) return externalThemeUrls[themeId];
  return `${import.meta.env.BASE_URL}themes/${themeId}.css`;
}

/** 当前活跃的 <link> 元素 */
let activeThemeLink: HTMLLinkElement | null = null;

/** 当前已应用的预设 id（与 link/attribute 状态一致） */
let appliedPresetId: string | null = null;

/**
 * 应用主题预设
 * 先加载新主题 CSS，onload 后再移除旧主题，避免闪烁。
 * 未知主题 id（插件清单尚未到达）→ 记录 pending，不发起加载。
 */
export function applyThemePreset(presetId: string): void {
  // 幂等：与当前已应用主题相同则跳过（避免重复请求）
  if (appliedPresetId === presetId) return;

  // 未知主题：置 pending，等注册表变化后补应用（retryPendingTheme）
  if (!getThemePreset(presetId)) {
    pendingPresetId = presetId;
    return;
  }

  const oldLink = activeThemeLink;
  activeThemeLink = null;
  appliedPresetId = presetId;

  // default 主题：无 CSS 文件，直接清除 data-theme 并移除旧 CSS
  if (presetId === "default") {
    if (oldLink) oldLink.remove();
    document.documentElement.removeAttribute("data-theme");
    return;
  }

  // 创建新 <link>，加载完成后再移除旧的
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = getThemeCssUrl(presetId);
  link.onload = () => {
    // 新主题已就绪，安全移除旧主题
    if (oldLink && oldLink.parentNode) {
      oldLink.remove();
    }
  };
  // 加载失败也需移除旧主题，避免卡在中间状态
  link.onerror = () => {
    if (oldLink && oldLink.parentNode) {
      oldLink.remove();
    }
  };
  document.head.appendChild(link);
  activeThemeLink = link;

  // 设置 data-theme 属性，使 CSS 选择器匹配
  // 新旧 CSS 同时存在期间，data-theme 已指向新主题，
  // 旧 CSS 的 [data-theme="oldId"] 不再匹配，新 CSS 的 [data-theme="newId"] 匹配
  document.documentElement.setAttribute("data-theme", presetId);
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
  if (activeThemeLink) {
    activeThemeLink.remove();
    activeThemeLink = null;
  }
}

/**
 * 获取主题信息
 */
export function getThemePreset(id: string): ThemePresetInfo | undefined {
  return themePresets.find((t) => t.id === id);
}
