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
import { initGlobalErrorHandler } from "@/utils/globalErrorHandler";
import { useLayoutStore } from "./stores/layout";
import {
  backendReady,
  backendError,
  isElectron,
} from "@/composables/useBackendStatus";

// 页面刷新标志：首次导航时强制服务端验证 token，后续路由切换不再重复验证
let isInitialPageLoad = true;

// Electron 环境下：同步查询后端状态，在 Vue 挂载前确定初始值（防刷新闪烁）
if (isElectron && window.electronAPI?.getBackendStatusSync) {
  const status = window.electronAPI.getBackendStatusSync();
  backendReady.value = status.ready;
}
// 刷新场景：后端已在运行，直接获取端口
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
        meta: { title: "对话", requiresAuth: true },
        component: () => import("./components/chat/ChatPage.vue"),
      },
      {
        path: "characters/:tab?",
        name: "Characters",
        meta: { title: "助手", requiresAuth: true },
        component: () => import("./components/characters/CharactersPage.vue"),
      },
      {
        path: "bots/:tab?",
        name: "Bots",
        meta: { title: "Bots", requiresAuth: true },
        component: () => import("./components/bot/BotCenterPage.vue"),
      },
      {
        path: "setting/:tab?",
        name: "SystemSettings",
        meta: { title: "系统设置", requiresAuth: true },
        component: () => import("./components/setting/SystemSettings.vue"),
      },
      {
        path: "plugins/:tab?",
        name: "Plugins",
        meta: { title: "插件", requiresAuth: true },
        component: () => import("./components/plugins/PluginsPage.vue"),
      },
      {
        path: "knowledge-base/:id?",
        name: "KnowledgeBase",
        meta: { title: "知识库", requiresAuth: true },
        component: () =>
          import("./components/knowledge-base/KnowledgeBasePage.vue"),
      },
      {
        path: "scheduler",
        name: "Scheduler",
        meta: { title: "定时任务", requiresAuth: true },
        component: () => import("./components/scheduler/SchedulerPage.vue"),
      },
      {
        path: "models",
        name: "Models",
        meta: { title: "模型管理", requiresAuth: true },
        component: () => import("./components/models/ModelsPage.vue"),
      },
    ],
  },
  {
    path: "/login",
    name: "Login",
    meta: { title: "登录" },
    component: () => import("./components/LoginPage.vue"),
  },
  {
    path: "/password",
    name: "Password",
    meta: { title: "密码设置" },
    component: () => import("./components/PasswordPage.vue"),
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

  // 后端就绪后若还在加载页，跳回原始目标
  if (to.path === "/empty") {
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
    // 页面加载后的首次导航：先尝试自动登录（如果开启了免登录模式）
    if (!authStore.isAuthenticated) {
      await authStore.checkAutoLoginStatus();
      if (authStore.autoLoginEnabled) {
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
const pinia = createPinia();

app.use(pinia);
app.use(router);

// 初始化全局错误处理器（在 router 挂载后）
initGlobalErrorHandler(router);

// 后端未就绪时才注册异步等待（已就绪说明是刷新场景，无需再监听）
if (isElectron && !backendReady.value && window.electronAPI?.waitBackendReady) {
  // 超时保护：60 秒后显示错误
  const timeoutId = setTimeout(() => {
    if (!backendReady.value) {
      backendError.value = "后端启动超时，请检查后端进程或重启应用";
    }
  }, 60000);

  window.electronAPI.waitBackendReady().then((data) => {
    clearTimeout(timeoutId);
    if (backendError.value) return; // 已显示超时错误，不再覆盖
    if (data.port) {
      console.log(`🔗 后端已就绪，端口: ${data.port}`);
      apiService.initBackendUrl().then(() => {
        backendReady.value = true;
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
}

app.mount("#app");
