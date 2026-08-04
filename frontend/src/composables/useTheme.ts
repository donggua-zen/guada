// composables/useTheme.ts
import { ref, computed, watch } from "vue";
import { applyThemePreset } from "@/themes";

/**
 * 主题管理 Composable
 * 支持三态切换：浅色 / 深色 / 跟随系统
 * 支持浅色/暗色分别设置主题预设（data-theme 属性 + 运行时 CSS 加载）
 */

export type ThemeMode = "light" | "dark" | "system";
export type ThemePreset = string; // 'default' | 'ocean' | 'forest' | ... | 插件自定义

// 模块级响应式状态（单例）
const themeMode = ref<ThemeMode>("system");
const lightThemePreset = ref<ThemePreset>("default");
const darkThemePreset = ref<ThemePreset>("default");
const systemPrefersDark = ref<boolean>(
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);

// 监听系统主题变化
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", (e) => {
    systemPrefersDark.value = e.matches;
  });

const savedMode = localStorage.getItem("theme-mode") as ThemeMode | null;
if (savedMode) {
  themeMode.value = savedMode;
}

const savedLightPreset = localStorage.getItem("theme-preset-light");
const savedDarkPreset = localStorage.getItem("theme-preset-dark");
if (savedLightPreset) {
  lightThemePreset.value = savedLightPreset;
}

if (savedDarkPreset) {
  darkThemePreset.value = savedDarkPreset;
}

// isDark 作为计算属性，跟随 themeMode 和系统偏好
const isDark = computed<boolean>(() => {
  if (themeMode.value === "system") return systemPrefersDark.value;
  return themeMode.value === "dark";
});

// 当前生效的主题预设：暗色模式用 darkThemePreset，浅色用 lightThemePreset
const activeThemePreset = computed<ThemePreset>(() => {
  return isDark.value ? darkThemePreset.value : lightThemePreset.value;
});

// 设置主题模式
const setTheme = (mode: ThemeMode): void => {
  themeMode.value = mode;
};

// 切换主题（向后兼容：在亮/暗之间切换）
const toggleDark = (): void => {
  themeMode.value = isDark.value ? "light" : "dark";
};

// 设置当前生效的主题预设（根据 isDark 自动写入 light 或 dark）
const setActiveThemePreset = (preset: ThemePreset): void => {
  if (isDark.value) {
    darkThemePreset.value = preset;
  } else {
    lightThemePreset.value = preset;
  }
};

// 设置浅色主题预设
const setLightThemePreset = (preset: ThemePreset): void => {
  lightThemePreset.value = preset;
};

// 设置暗色主题预设
const setDarkThemePreset = (preset: ThemePreset): void => {
  darkThemePreset.value = preset;
};

// 监听 isDark 变化，同步到 DOM
watch(isDark, (newVal: boolean) => {
  if (newVal) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
});

// 监听 themeMode 变化，持久化到 localStorage
watch(themeMode, (newVal: ThemeMode) => {
  localStorage.setItem("theme-mode", newVal);
  // 迁移完成后清理旧 key
  localStorage.removeItem("color-scheme");
});

// 监听浅色/暗色主题预设变化，持久化
watch(lightThemePreset, (newVal: ThemePreset) => {
  localStorage.setItem("theme-preset-light", newVal);
});
watch(darkThemePreset, (newVal: ThemePreset) => {
  localStorage.setItem("theme-preset-dark", newVal);
});

// 监听 activeThemePreset 变化（由 isDark 切换或预设编辑触发），应用到 DOM
watch(activeThemePreset, (newVal: ThemePreset) => {
  applyThemePreset(newVal);
});

// 初始应用 DOM 状态
document.documentElement.classList.toggle("dark", isDark.value);
applyThemePreset(activeThemePreset.value);

/**
 * 主题 Composable 返回值类型
 */
export interface UseThemeReturn {
  isDark: typeof isDark;
  themeMode: typeof themeMode;
  lightThemePreset: typeof lightThemePreset;
  darkThemePreset: typeof darkThemePreset;
  activeThemePreset: typeof activeThemePreset;
  toggleDark: typeof toggleDark;
  setTheme: typeof setTheme;
  setActiveThemePreset: typeof setActiveThemePreset;
  setLightThemePreset: typeof setLightThemePreset;
  setDarkThemePreset: typeof setDarkThemePreset;
}

export function useTheme(): UseThemeReturn {
  return {
    isDark,
    themeMode,
    lightThemePreset,
    darkThemePreset,
    activeThemePreset,
    toggleDark,
    setTheme,
    setActiveThemePreset,
    setLightThemePreset,
    setDarkThemePreset,
  };
}
