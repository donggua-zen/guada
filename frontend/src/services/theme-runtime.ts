/**
 * 主题运行时（v3：主题 = 皮肤）
 *
 * 统一模型：
 * - **纯 CSS 主题**：只给 cssFile / cssFiles，靠 `html[data-theme=x]` 变量覆盖；
 * - **富主题**（原「皮肤」）：额外给 runtimeScript / assetBase / bodyAttribute / settings，
 *   宿主会在 `data-theme` 之上再打 body 作用域属性、执行运行时脚本、必要时压制壁纸。
 *
 * 三条硬约束（对应 dsh 皮肤的可卸载要求）：
 * 1. **互斥**：同一时间只有一个主题生效；切换前必须先完整卸载。
 * 2. **可还原**：所有宿主写入（`data-theme`、body 属性、CSS 变量、`<link>`、
 *    `<script>`、自建节点、壁纸变量）都必须记录原值并在卸载时还原。
 * 3. **资源同源**：一律走 `/plugins/:id/assets/`，不内联进 bundle。
 */

import { ref } from 'vue';

const SHARED_KEY = '__GuaDaTheme__';


export interface ThemeManifest {
  pluginId: string;
  id: string;
  name: string;
  primaryColor?: string;
  secondaryColor?: string;
  mode?: 'light' | 'dark' | 'all';
  cssFile?: string;
  cssFiles?: { light?: string; dark?: string };
  runtimeScript?: string;
  assetBase?: string;
  bodyAttribute?: string;
  settings?: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'boolean';
    default?: unknown;
    description?: string;
    options?: Array<{ label: string; value: unknown }>;
    showIf?:
      | { field: string; equals: unknown }
      | { anyOf: Array<{ field: string; equals: unknown }> };
  }>;
  preview?: { light?: string; dark?: string };
  ownsBackground?: boolean;
  recommendedThemes?: string[];
  rev?: string;
  /** 已解析的 CSS 地址（由调用方按资产端点拼好） */
  cssUrl?: string;
  cssUrls?: { light?: string; dark?: string };
}

/** 富主题 = 带运行时或资源目录（原「皮肤」） */
export function isRichTheme(manifest?: Partial<ThemeManifest> | null): boolean {
  return Boolean(manifest && (manifest.runtimeScript || manifest.assetBase));
}

/** 主题脚本拿到的宿主钩子 */
export interface ThemeRuntimeApi {
  /** 作用域属性名（已打在 body 上） */
  bodyAttribute: string;
  /** 资源 URL 构造（相对插件根） */
  assetUrl: (file: string) => string;
  /** 读当前主题设置值 */
  getSetting: (key: string) => unknown;
  /** 订阅设置变化；返回取消函数 */
  onSettingChange: (listener: (key: string, value: unknown) => void) => () => void;
  /** 登记自建节点，卸载时自动移除 */
  own: (node: Element) => void;
  /** 登记需要还原的 body 属性 */
  setBodyAttribute: (name: string, value: string | null) => void;
  /** 登记需要还原的 CSS 变量（写在 documentElement） */
  setCssVariable: (name: string, value: string) => void;
  /** 当前是否暗色 */
  isDark: () => boolean;
  /** 订阅亮/暗切换；返回取消函数 */
  onModeChange: (listener: (isDark: boolean) => void) => () => void;
}

interface ActiveTheme {
  manifest: ThemeManifest;
  links: HTMLLinkElement[];
  scripts: HTMLScriptElement[];
  disposers: Array<() => void>;
  ownedNodes: Set<Element>;
  bodyAttrs: Map<string, string | null>;
  cssVars: Map<string, { value: string; priority: string }>;
  settingListeners: Set<(key: string, value: unknown) => void>;
  modeListeners: Set<(isDark: boolean) => void>;
  /** ownsBackground 时被临时清空的壁纸变量原值 */
  wallpaper: { image: string; loadedClass: boolean } | null;
  previousDataTheme: string | null;
}

let active: ActiveTheme | null = null

/**
 * 当前主题是否接管了背景（ownsBackground）。
 *
 * 用途：富主题自己画全窗背景时会压掉宿主壁纸，但 `layoutStore.wallpaperUrl` 仍然留着
 * 用户配置（那是「切回默认主题后该恢复什么」的唯一真相，不能清）。于是「有没有壁纸」
 * 的消费方必须区分两件事：用户配过壁纸 ≠ 此刻屏幕上有壁纸。
 * 只看 store 会导致 qi-dusk 下输入框继续挂 backdrop-blur-xl（24px），
 * 压在主题的四层背景画布上每帧重算模糊。
 *
 * 用 ref 而不是纯函数：主题切换（含异步加载完 CSS）后消费方要能自动重算。
 */
export const themeOwnsBackground = ref(false);

function baseURL(): string {
  const shared = (window as any).__GuaDaShared__;
  const base = String(shared?.pluginApi?.baseURL || '/api/v1');
  return base.replace(/\/$/, '');
}

export function themeAssetUrl(pluginId: string, file: string, rev?: string): string {
  const rel = file.replace(/^\/+/, '');
  const suffix = rev ? `?rev=${encodeURIComponent(rev)}` : '';
  return `${baseURL()}/plugins/${pluginId}/assets/${rel}${suffix}`;
}

/**
 * 主题包内资源 URL：自动拼上 `assetBase` 前缀。
 * （`cssFile` 是相对插件根的路径，不走这里；只有运行时 `assetUrl()` 需要前缀。）
 */
function themePackageAssetUrl(
  manifest: ThemeManifest,
  file: string,
): string {
  const base = String(manifest.assetBase || '').replace(/^\/+|\/+$/g, '');
  const rel = base ? `${base}/${file.replace(/^\/+/, '')}` : file;
  return themeAssetUrl(manifest.pluginId, rel, manifest.rev);
}

export function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

function resolveCssHref(manifest: ThemeManifest, dark: boolean): string | undefined {
  const urls = manifest.cssUrls;
  if (urls) return dark ? urls.dark || urls.light : urls.light || urls.dark;
  const files = manifest.cssFiles || (manifest.cssFile ? { light: manifest.cssFile, dark: manifest.cssFile } : undefined);
  const file = files ? (dark ? files.dark || files.light : files.light || files.dark) : undefined;
  return file ? themeAssetUrl(manifest.pluginId, file, manifest.rev) : manifest.cssUrl;
}

function loadStylesheet(href: string, previous?: HTMLLinkElement): Promise<HTMLLinkElement> {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.gdTheme = '1';
    const drop = () => {
      if (previous && previous.parentNode) previous.remove();
    };
    link.onload = () => {
      drop();
      resolve(link);
    };
    // 失败也 resolve：缺一份 CSS 不该卡住整个应用
    link.onerror = () => {
      drop();
      resolve(link);
    };
    document.head.appendChild(link);
  });
}

/**
 * 应用一个主题（纯 CSS 或富主题）。
 *
 * @param manifest 主题清单（含已解析的 cssUrl/cssUrls）
 * @param values   该插件 `plugin:<id>` 数据（供运行时读设置）
 */
export async function applyTheme(
  manifest: ThemeManifest,
  values: Record<string, unknown> = {},
): Promise<void> {
  removeTheme();

  const dark = isDarkMode();
  const href = resolveCssHref(manifest, dark);

  const state: ActiveTheme = {
    manifest,
    links: [],
    scripts: [],
    disposers: [],
    ownedNodes: new Set(),
    bodyAttrs: new Map(),
    cssVars: new Map(),
    settingListeners: new Set(),
    modeListeners: new Set(),
    wallpaper: null,
    previousDataTheme: document.documentElement.getAttribute('data-theme'),
  };
  active = state;

  // 1. data-theme（纯 CSS 主题靠它命中变量覆盖）
  document.documentElement.setAttribute('data-theme', manifest.id);

  // 2. 样式表（先上新、再撤旧，避免闪白）
  if (href) {
    const link = await loadStylesheet(href);
    if (active !== state) {
      link.remove();
      return;
    }
    state.links.push(link);
  }

  // 3. 富主题：body 作用域 + 资源 + 设置 + 壁纸压制
  if (isRichTheme(manifest)) {
    const bodyAttribute =
      manifest.bodyAttribute ||
      `data-gd-theme-${manifest.id.replace(/[^A-Za-z0-9]+/g, '-')}`;
    state.bodyAttrs.set(bodyAttribute, document.body.getAttribute(bodyAttribute));
    document.body.setAttribute(bodyAttribute, '');

    if (manifest.ownsBackground) {
      const root = document.documentElement;
      state.wallpaper = {
        image: root.style.getPropertyValue('--wallpaper-image'),
        loadedClass: root.classList.contains('wallpaper-loaded'),
      };
      root.style.setProperty('--wallpaper-image', 'none');
      root.classList.remove('wallpaper-loaded');
    }
  }

  // 背景接管态同步给消费方（CSS 变量只是「画面上没壁纸」，这是「逻辑上别当有壁纸」）
  themeOwnsBackground.value = !!manifest.ownsBackground;

  // 4. 亮/暗切换：两套 CSS 都给时监听 html.class
  const files = manifest.cssFiles;
  if (files?.light && files?.dark && files.light !== files.dark) {
    let currentDark = dark;
    const onMode = () => {
      if (active !== state) return;
      const next = isDarkMode();
      if (next === currentDark) return;
      currentDark = next;
      const nextHref =
        (manifest.cssUrls ? (next ? manifest.cssUrls.dark : manifest.cssUrls.light) : undefined) ||
        themeAssetUrl(manifest.pluginId, next ? files.dark! : files.light!, manifest.rev);
      const stale = state.links.splice(0, state.links.length);
      void loadStylesheet(nextHref, stale[0]).then((link) => {
        if (active !== state) {
          link.remove();
          return;
        }
        state.links.push(link);
        for (const old of stale.slice(1)) old.remove();
      });
      for (const listener of state.modeListeners) {
        try {
          listener(next);
        } catch (error) {
          console.warn('[gd-theme] mode listener failed', error);
        }
      }
    };
    const observer = new MutationObserver(onMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    state.disposers.push(() => observer.disconnect());
  }

  // 5. 运行时脚本
  if (manifest.runtimeScript) {
    const settings: Record<string, unknown> = {};
    for (const field of manifest.settings || []) {
      settings[field.key] = values[field.key] !== undefined ? values[field.key] : field.default;
    }
    const api: ThemeRuntimeApi = {
      bodyAttribute:
        manifest.bodyAttribute ||
        `data-gd-theme-${manifest.id.replace(/[^A-Za-z0-9]+/g, '-')}`,
      assetUrl: (file) => themePackageAssetUrl(manifest, file),
      getSetting: (key) => settings[key],
      onSettingChange: (listener) => {
        state.settingListeners.add(listener);
        return () => state.settingListeners.delete(listener);
      },
      own: (node) => {
        state.ownedNodes.add(node);
        if (!node.isConnected) document.body.appendChild(node);
      },
      setBodyAttribute: (name, value) => {
        if (!state.bodyAttrs.has(name)) {
          state.bodyAttrs.set(name, document.body.getAttribute(name));
        }
        if (value === null) document.body.removeAttribute(name);
        else document.body.setAttribute(name, value);
      },
      setCssVariable: (name, value) => {
        const root = document.documentElement;
        if (!state.cssVars.has(name)) {
          state.cssVars.set(name, {
            value: root.style.getPropertyValue(name),
            priority: root.style.getPropertyPriority(name),
          });
        }
        root.style.setProperty(name, value);
      },
      isDark: isDarkMode,
      onModeChange: (listener) => {
        state.modeListeners.add(listener);
        return () => state.modeListeners.delete(listener);
      },
    };

    const scriptUrl = themeAssetUrl(manifest.pluginId, manifest.runtimeScript, manifest.rev);
    await new Promise<void>((resolve) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.dataset.gdTheme = '1';
      script.onload = () => {
        if (active !== state) {
          resolve();
          return;
        }
        const hook = (window as any)[SHARED_KEY];
        if (typeof hook === 'function') {
          try {
            const dispose = hook(api, manifest);
            if (typeof dispose === 'function') state.disposers.push(dispose);
          } catch (error) {
            console.error(`[gd-theme] ${manifest.id} runtime threw`, error);
          }
        } else {
          console.warn(
            `[gd-theme] ${manifest.id} runtime did not register window.${SHARED_KEY}(api)`,
          );
        }
        resolve();
      };
      script.onerror = () => {
        console.warn(`[gd-theme] runtime failed to load: ${scriptUrl}`);
        resolve();
      };
      document.head.appendChild(script);
      state.scripts.push(script);
    });
  }
}

/** 卸载当前主题并还原所有宿主写入 */
export function removeTheme(): void {
  const state = active;
  if (!state) return;
  active = null;
  themeOwnsBackground.value = false;

  for (const dispose of state.disposers.splice(0)) {
    try {
      dispose();
    } catch (error) {
      console.warn('[gd-theme] disposer failed', error);
    }
  }

  for (const node of state.ownedNodes) {
    try {
      node.remove();
    } catch {
      /* ignore */
    }
  }
  state.ownedNodes.clear();

  for (const link of state.links.splice(0)) {
    try {
      link.remove();
    } catch {
      /* ignore */
    }
  }
  for (const script of state.scripts.splice(0)) {
    try {
      script.remove();
    } catch {
      /* ignore */
    }
  }

  for (const [name, value] of state.bodyAttrs) {
    if (value === null) document.body.removeAttribute(name);
    else document.body.setAttribute(name, value);
  }
  state.bodyAttrs.clear();

  for (const [name, original] of state.cssVars) {
    const root = document.documentElement;
    if (original.value === '') root.style.removeProperty(name);
    else root.style.setProperty(name, original.value, original.priority);
  }
  state.cssVars.clear();

  if (state.wallpaper) {
    const root = document.documentElement;
    if (state.wallpaper.image) root.style.setProperty('--wallpaper-image', state.wallpaper.image);
    else root.style.removeProperty('--wallpaper-image');
    if (state.wallpaper.loadedClass) root.classList.add('wallpaper-loaded');
  }

  // data-theme 由调用方（themes/index）决定回退到哪个值
  state.settingListeners.clear();
  state.modeListeners.clear();
}

/** 当前生效主题 id（无则 null） */
export function activeThemeId(): string | null {
  return active?.manifest.id ?? null;
}

/** 设置变化时通知主题运行时（由设置页调用） */
export function notifyThemeSetting(key: string, value: unknown): void {
  if (!active) return;
  for (const listener of active.settingListeners) {
    try {
      listener(key, value);
    } catch (error) {
      console.warn('[gd-theme] setting listener failed', error);
    }
  }
}

/** 仅用于测试/热重载：清空内部状态 */
export function _resetThemeRuntime(): void {
  if (active) removeTheme();
  themeOwnsBackground.value = false;
}
