/**
 * 主题注册表与加载器
 *
 * 内置主题 CSS 存放在 public/themes/，运行时按需 <link> 加载。
 * 插件可通过 registerTheme() 注册外部主题，走同一条加载路径。
 */

export interface ThemePresetInfo {
  id: string;
  name: string;
  /** 主色，用于下拉圆点预览 */
  primaryColor: string;
  /** 副色，用于下拉圆点预览 */
  secondaryColor: string;
}

/** 内置主题注册表 */
const builtinThemes: ThemePresetInfo[] = [
  {
    id: "default",
    name: "默认（B站粉）",
    primaryColor: "#fb7299",
    secondaryColor: "#5b8def",
  },
  {
    id: "brutalist",
    name: "粗野主义",
    primaryColor: "#141414",
    secondaryColor: "#ffcf00",
  },
  {
    id: "blueprint",
    name: "工程蓝图",
    primaryColor: "#2060b0",
    secondaryColor: "#0e8fa8",
  },
  {
    id: "steampunk",
    name: "蒸汽朋克",
    primaryColor: "#a55e28",
    secondaryColor: "#3e7d6f",
  },
  {
    id: "y2k",
    name: "千禧铬彩",
    primaryColor: "#6673f0",
    secondaryColor: "#e854ae",
  },
  {
    id: "pop-comic",
    name: "波普漫画",
    primaryColor: "#ee2233",
    secondaryColor: "#1f6fff",
  },
  {
    id: "famicom",
    name: "红白机",
    primaryColor: "#c8102e",
    secondaryColor: "#f0b400",
  },
  {
    id: "e-ink",
    name: "墨水屏",
    primaryColor: "#3a3a3a",
    secondaryColor: "#8a8578",
  },
  {
    id: "doodle",
    name: "涂鸦本",
    primaryColor: "#3a7bd5",
    secondaryColor: "#e8854a",
  },
];

/** 可追加注册表（插件扩展点） */
export const themePresets: ThemePresetInfo[] = [...builtinThemes];

/** 插件注册的外部 CSS URL */
const externalThemeUrls: Record<string, string> = {};

/**
 * 注册新主题（插件扩展点）
 * @param info 主题信息
 * @param cssUrl 主题 CSS 文件 URL（不传则从 public/themes/{id}.css 加载）
 */
export function registerTheme(info: ThemePresetInfo, cssUrl?: string): void {
  if (cssUrl) externalThemeUrls[info.id] = cssUrl;
  // 避免重复注册
  if (!themePresets.some((t) => t.id === info.id)) {
    themePresets.push(info);
  }
}

/**
 * 获取主题 CSS URL
 * 插件注册的外部 URL 优先；内置主题从 public/ 静态加载
 */
function getThemeCssUrl(themeId: string): string {
  if (externalThemeUrls[themeId]) return externalThemeUrls[themeId];
  return `${import.meta.env.BASE_URL}themes/${themeId}.css`;
}

/** 当前活跃的 <link> 元素 */
let activeThemeLink: HTMLLinkElement | null = null;

/**
 * 应用主题预设
 * 先加载新主题 CSS，onload 后再移除旧主题，避免闪烁
 */
export function applyThemePreset(presetId: string): void {
  const oldLink = activeThemeLink;
  activeThemeLink = null;

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
 * 获取主题信息
 */
export function getThemePreset(id: string): ThemePresetInfo | undefined {
  return themePresets.find((t) => t.id === id);
}
