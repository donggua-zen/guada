import { createApp } from "vue";

import App from "./App.vue";
import {
  createRouter,
  createWebHistory,
  createWebHashHistory,
} from "vue-router";
import { createPinia } from "pinia";
import { useAuthStore } from "./stores/auth";
import NProgress from "nprogress";

import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "./tailwind.css";
import "./style.css";
import "nprogress/nprogress.css";

import { apiService } from "@/services/ApiService";
import * as Vue from "vue";
import ElementPlus from "element-plus";
import { reactive, watch } from "vue";
import "@/services/plugin-loader";
import { registerUiPrimitives } from "@/components/ui/register";
import { initGlobalErrorHandler } from "@/utils/globalErrorHandler";
import { useLayoutStore } from "./stores/layout";
import {
  backendReady,
  backendError,
  isElectron,
} from "@/composables/useBackendStatus";
import { i18n } from "./locales";

// 平台标记挂到 <html>：布局按平台差异处理
// （Electron-Windows 有独立标题栏行，内容卡片顶/左不留边距；Web/Mac 卡片顶部留缝防吸顶）
document.documentElement.classList.add(
  isElectron
    ? window.electronAPI?.platform === "darwin"
      ? "platform-mac"
      : "platform-win"
    : "platform-web",
);

// 页面刷新标志：首次导航时强制服务端验证 token，后续路由切换不再重复验证
let isInitialPageLoad = true;

// Electron 环境下：同步查询后端状态，在 Vue 挂载前确定初始值（防刷新闪烁）
if (isElectron && window.electronAPI?.getBackendStatusSync) {
  const status = window.electronAPI.getBackendStatusSync();
  backendReady.value = status.ready;
  // 刷新场景：后端已在运行，同步 IPC 已携带真实端口。
  // 立即设置 baseURL，确保首屏请求（checkAuth / loadAppearanceSettings）
  // 不会抢在异步获取端口前打到默认的 localhost:3000
  if (status.ready && status.port) {
    apiService.initBackendUrl(status.port);
  }
}
// 刷新场景兜底：后端已就绪但端口未知时，再走异步获取
if (isElectron && backendReady.value) {
  apiService.initBackendUrl();
}

// 配置 NProgress
NProgress.configure({
  easing: "ease-in-out",
  speed: 1000,
  showSpinner: false,
  trickle: true,
  trickleSpeed: 200,
  minimum: 0.08,
  // 在 Electron 环境下完全禁用进度条
  disabled: isElectron,
});

const routes = [
  {
    path: "/",
    component: () => import("./components/MainLayout.vue"),
    children: [
      {
        path: "",
        name: "Home",
        redirect: "/chat/new-session",
      },
      {
        path: "chat/:sessionId?",
        name: "Chat",
        meta: { titleKey: "common.route.chat", requiresAuth: true },
        component: () => import("./components/chat/ChatPage.vue"),
      },
      {
        path: "agents/:tab?",
        name: "Agents",
        meta: { titleKey: "common.route.agents", requiresAuth: true },
        component: () => import("./components/agents/AgentsPage.vue"),
      },
      {
        path: "bots/:tab?",
        name: "Bots",
        meta: { titleKey: "common.route.bots", requiresAuth: true },
        component: () => import("./components/bot/BotCenterPage.vue"),
      },
      {
        path: "setting/:tab?",
        name: "SystemSettings",
        meta: { titleKey: "common.route.settings", requiresAuth: true },
        component: () => import("./components/setting/SystemSettings.vue"),
      },
      {
        path: "plugins/:tab?",
        name: "Plugins",
        meta: { titleKey: "common.route.plugins", requiresAuth: true },
        component: () => import("./components/plugins/PluginsPage.vue"),
      },
      {
        path: "knowledge-base/:id?",
        name: "KnowledgeBase",
        meta: { titleKey: "common.route.knowledgeBase", requiresAuth: true },
        component: () =>
          import("./components/knowledge-base/KnowledgeBasePage.vue"),
      },
      {
        path: "scheduler",
        name: "Scheduler",
        meta: { titleKey: "common.route.scheduler", requiresAuth: true },
        component: () => import("./components/scheduler/SchedulerPage.vue"),
      },
      {
        path: "models",
        name: "Models",
        meta: { titleKey: "common.route.models", requiresAuth: true },
        component: () => import("./components/models/ModelsPage.vue"),
      },
    ],
  },
  {
    path: "/login",
    name: "Login",
    meta: { titleKey: "common.route.login" },
    component: () => import("./components/LoginPage.vue"),
  },
  {
    path: "/test",
    name: "Test",
    meta: { title: "UI 测试" },
    component: () => import("./components/test/ui.vue"),
  },
  {
    path: "/splitpanes-test",
    name: "SplitpanesTest",
    meta: { title: "Splitpanes 性能测试" },
    component: () => import("./components/test/SplitpanesPerfTest.vue"),
  },
  {
    path: "/simple-test",
    name: "SimpleTest",
    meta: { title: "简单测试" },
    component: () => import("./components/test/SimpleTest.vue"),
  },
  {
    path: "/input-test",
    name: "InputTest",
    meta: { title: "Contenteditable 输入测试" },
    component: () => import("./components/test/InputTest.vue"),
  },
  {
    path: "/empty",
    name: "Empty",
    component: () => import("./components/BackendWaitingOverlay.vue"),
  },
];

// 根据环境动态选择路由模式
// Electron 环境使用 Hash 模式（file:// 协议不支持 History 模式）
// Web 环境使用 History 模式（URL 更美观）
const router = createRouter({
  history: isElectron ? createWebHashHistory() : createWebHistory(),
  routes,
});

router.beforeEach(async (to, from, next) => {
  // 后端未就绪时重定向到加载页，保存原始目标
  if (!backendReady.value) {
    if (to.path !== "/empty") {
      return next({ path: "/empty", query: { redirect: to.fullPath } });
    }
    return next();
  }

  // 后端就绪后若还在加载页，跳回原始目标（preview 模式除外）
  if (to.path === "/empty") {
    if (to.query.preview) {
      return next();
    }
    const target = to.query.redirect || "/";
    return next(target);
  }

  // 仅在非 Electron 环境下显示进度条
  if (!isElectron) {
    NProgress.start();
  }

  console.log("Navigating to:", to.path);

  const authStore = useAuthStore();

  // 3. 正常的鉴权逻辑
  if (to.meta.requiresAuth) {
    // 页面加载后的首次导航：未设密码则免登录直通
    if (!authStore.isAuthenticated) {
      const passwordSet = await authStore.checkAuthStatus();
      if (!passwordSet) {
        const success = await authStore.tryAutoLogin();
        if (success) {
          isInitialPageLoad = false;
          return next();
        }
      }
    }

    // 页面加载后的首次导航：从 storage 恢复 token（如果尚未恢复）
    if (!authStore.isAuthenticated) {
      const initialized = await authStore.initializeAuth();
      if (initialized) {
        isInitialPageLoad = false;
        return next();
      }
    }

    // 页面加载后的首次导航 — 强制服务端验证 token 有效性
    // 当 isInitialPageLoad 为 true 时，无论 isAuthenticated 是否为 true，
    // 都调用 checkAuth() 向后端发送 /user/profile 请求验证 token
    if (isInitialPageLoad) {
      isInitialPageLoad = false;
      const isValid = await authStore.checkAuth();
      if (!isValid) {
        return next("/login");
      }
      return next();
    }

    // 后续路由切换：只检查本地是否有 token，不重复调用 API
    // token 过期由页面内具体 API 请求自行验证（401 会统一触发跳转）
    if (!authStore.isAuthenticated) {
      return next("/login");
    }
  }

  next();
});

// 全局后置守卫
router.afterEach(() => {
  // 仅在非 Electron 环境下结束进度条
  if (!isElectron) {
    NProgress.done();
  }
});

const app = createApp(App);
// ── 插件运行时共享环境（__GuaDaShared__）──
// runtime：响应式共享数据（用户/会话/语言/主题），插件 UI 可响应式读取
// i18n：插件语言包注册表（{ zh, en } 字典）
window.__GuaDaShared__ = {
  // 共享依赖：主应用同一个 Vue / ElementPlus 实例（插件产物从这里取，不 import）
  vue: Vue,
  "element-plus": ElementPlus,
  runtime: reactive({
    user: undefined,
    session: { id: undefined, workspaceId: undefined, workspaceName: undefined },
    locale: localStorage.getItem("app-language") || "zh-CN",
    theme: "dark",
  }),
  i18n: {
    dictionaries: new Map(),
    register(pluginId, messages) {
      this.dictionaries.set(pluginId, messages);
      return () => this.dictionaries.delete(pluginId);
    },
    t(pluginId, key, params) {
      const dict = this.dictionaries.get(pluginId);
      const lang = window.__GuaDaShared__?.runtime?.locale;
      const table = (dict && (dict[lang] || dict.en)) || {};
      let text = table[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) text = text.replace(`{${k}}`, v);
      return text;
    },
  },
  // apiService 实例（含 _request 和所有领域 API 方法）
  pluginApi: apiService,
};
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(i18n);
// 全局注册 ElementPlus：主应用自身靠 unplugin 按需导入，但插件产物是运行时加载的 IIFE，
// resolveComponent('el-xxx') 需要全局注册才能解析（插件模板可直接写 el-button/el-input）
app.use(ElementPlus);
// 插件 UI 原语全局注册：让插件产物运行时能 resolveComponent('GdXxx')
registerUiPrimitives(app);

// 用户信息同步到插件运行时（__GuaDaShared__.runtime.user），登录/登出自动更新
const authStore = useAuthStore(pinia);
watch(
  () => authStore.user,
  (user) => {
    window.__GuaDaShared__.runtime.user = user;
  },
  { immediate: true },
);

// 初始化全局错误处理器（在 router 挂载后）
initGlobalErrorHandler(router);

// 加载链接打开方式设置（从后端同步到 localStorage 缓存）。
// 必须在后端就绪后调用：冷启动时若抢在 NestJS 监听端口之前发请求，
// 会产生 ERR_CONNECTION_REFUSED 噪音日志（功能无影响，但干扰排查）。
function loadLinkOpenModeWhenReady() {
  import("@/utils/workspacePreview").then(({ loadLinkOpenMode }) => {
    loadLinkOpenMode();
  });
}

// 后端未就绪时才注册异步等待（已就绪说明是刷新场景，无需再监听）
if (isElectron && !backendReady.value && window.electronAPI?.waitBackendReady) {
  // 超时保护：60 秒后显示错误
  const timeoutId = setTimeout(() => {
    if (!backendReady.value) {
      backendError.value = "后端启动超时，请检查后端进程或重启应用";
      // 兜底：后端超时仍尝试加载（内部 catch 会降级到 localStorage 缓存）
      loadLinkOpenModeWhenReady();
    }
  }, 60000);

  window.electronAPI.waitBackendReady().then((data) => {
    clearTimeout(timeoutId);
    if (backendError.value) return; // 已显示超时错误，不再覆盖
    if (data.port) {
      console.log(` 后端已就绪，端口: ${data.port}`);
      apiService.initBackendUrl().then(async () => {
        // 关键时序：先让主题就绪（插件清单 + 主题 CSS 应用完成），再放行守卫
        // 并跳回主页面——此刻用户仍停留在品牌加载页（/empty），切换后主页面
        // 首帧即为用户所选主题，全程无闪烁。
        // backendReady 置位必须放在 await 之后：否则路由守卫（main.js:186-193）
        // 会在加载页状态时提前放行导航，主题尚未就绪导致闪变。
        await ensureThemeReady();
        backendReady.value = true;
        loadLinkOpenModeWhenReady();
        // 如果当前在加载页，跳回原始目标
        if (router.currentRoute.value.path === "/empty") {
          const redirect = router.currentRoute.value.query.redirect || "/";
          router.replace(typeof redirect === "string" ? redirect : "/");
        }
      });
    } else {
      console.error("❌ 后端启动失败:", data.error);
      backendError.value = data.error || "后端启动失败";
    }
  });
} else {
  // 非 Electron（Web 直连）或后端已就绪（刷新场景）：直接加载
  loadLinkOpenModeWhenReady();
}

// ── 主题就绪前置（防首帧主题闪烁）──
// 挂载前预取插件 slots+themes 清单，将插件主题注册进响应式注册表；
// useTheme 顶层 applyThemePreset 对持久化的插件主题 id 会先置 pending，
// 清单到达后由 themeRegistryVersion watch 自动补应用。
// 冷启动（后端未就绪）时 init 失败被内部 catch 吞掉，用户停留在品牌加载页
// （/empty）；后端就绪后由 waitBackendReady 回调（上方 333-358）在跳回
// 主页面之前 await 本函数补拉清单，首帧仍为正确主题。
const ensureThemeReady = async () => {
  try {
    const { usePluginSlots } = await import("@/stores/pluginSlots");
    await usePluginSlots(pinia).init();
  } catch (e) {
    console.warn("[theme] plugin slots init failed, degrade to default theme", e);
  }
};

if (isElectron) {
  ensureThemeReady().then(() => {
    app.mount("#app");
  });
} else {
  // Web 模式：同样在挂载前注册插件主题（后端未就绪时 init 失败被内部 catch，
  // 主题由 useTheme 运行时补应用），不阻塞首屏
  ensureThemeReady().then(() => {
    app.mount("#app");
  });
}