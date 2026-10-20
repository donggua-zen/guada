# 主题系统插件化改造方案

> 目标：把"主题"从内置静态注册表，改为由插件（内置/外部一致）注册声明，同时保证 Electron 下可加载、启动与切换均无闪烁。
> 结论先行：**可行，低侵入**。主题侧扩展点 `registerTheme()` 已存在（`frontend/src/themes/index.ts:111`），但未接入插件生命周期；核心改动约 5 个文件 + Electron 启动引导 1 处，不改动既有内置主题。

> **文档状态（2026-09-02）**：§1-§3 为改造前设计基线（含迁移前现状）；§4 起与 §10 实施记录为演进实况。**契约以最新实施为准**：
> - 内置 10 主题已迁移为插件注册（阶段 4），非"未迁移"
> - assets 端点契约为**相对插件根**（阶段 4b），非"frontend/dist 扁平文件名"——cssFile 可含子路径，CSS 可引用插件内任意受支持资源（字体/图片），famicom 字体已恢复文件引用
> - Electron 防闪烁为**加载页兜底**（阶段 3b），非 theme-ready 握手

---

## 1. 现状分析（文件:行号）

### 1.1 插件系统（双层架构，链路已打通）

| 层 | 关键点 | 位置 |
|---|---|---|
| 后端注册 | `PluginRegistry.registerSlot(pluginId, reg)`，聚合 slot 清单 | `backend-ts/src/modules/plugins/registry/plugin-registry.ts:149` |
| 清单 API | `GET /plugins/slots`，仅返回**已启用**插件的 slot，含 `pluginId/component/order/loadMode/meta/rev` | `backend-ts/src/modules/plugins/plugins.controller.ts:308` |
| 产物服务 | `GET /plugins/:pluginId/assets/:fileName`，从插件目录 `frontend/dist` 静态服务 JS/CSS，文件名白名单 `[A-Za-z0-9_-]`，`rev` 取 dist 最新 mtime 做缓存失效 | `plugins.controller.ts:347` / `:404` |
| 启停/安装 | `PUT /plugins/global`、install/uninstall/update/query | `plugins.controller.ts:185` |
| 前端加载器 | `window.__GuaDaModuleLoader__`：IIFE 产物 `register('pluginId:Name', {default})`，`prepare/import/invalidate/unload`，脚本 + 可选 cssUrl 注入 | `frontend/src/services/plugin-loader.js:56` |
| 前端清单 | Pinia `usePluginSlots`：拉 slots → `prepareExternal` 进加载器；SSE `plugins_changed` 全量刷新 | `frontend/src/stores/pluginSlots.js:46,114` |
| 事件广播 | 插件注册/卸载/启停 → SSE `plugins_changed` | `backend-ts/src/modules/chat/session-events.service.ts:296` |

### 1.2 主题系统（扩展点悬空）

| 关键点 | 位置 |
|---|---|
| 内置主题注册表 `builtinThemes`（11 个）→ 可追加数组 `themePresets` | `frontend/src/themes/index.ts:20,101` |
| **`registerTheme(info, cssUrl?)` 扩展点已存在，但全仓库无任何调用方** | `frontend/src/themes/index.ts:111` |
| 加载：`applyThemePreset(id)` 创建 `<link>`，**onload 后再移除旧 link**（切换防闪烁）；`data-theme` 属性匹配；default 无 CSS | `frontend/src/themes/index.ts:135` |
| CSS 契约：`html.dark[data-theme="x"] { --gd-color-* }`（dark class + data-theme 双条件），资源在 `frontend/public/themes/*.css` | `frontend/public/themes/cyberpunk.css:15` |
| 状态：三态（light/dark/system）+ 双预设；localStorage + 后端 appearance 设置（后端优先）；**模块顶层立即应用** | `frontend/src/composables/useTheme.ts:15,115` |
| 设置 UI：下拉列表 `const themePresetList = themePresets` —— **非响应式引用** | `frontend/src/components/setting/AppearanceSettings.vue:313` |
| 暗色基础变量（无主题 CSS 时暗色也可用） | `frontend/src/style.css:122` |

### 1.3 Electron 可加载性现状

| 项 | 现状 | 位置 |
|---|---|---|
| 窗口 | `show: false` + `backgroundColor: "#000000"` + `ready-to-show` 后才 `show()`（已挡启动白屏） | `electron/main.ts:1103,1175` |
| 入口 | 生产 `loadFile(frontend/dist/index.html)`（file://），dev 走 Vite；**index.html 无内联脚本、无主题预加载** | `electron/main.ts:1136-1150`、`frontend/index.html` |
| 后端通道 | Electron 下 `apiService.baseURL = http://localhost:PORT/api/v1`（随机端口，preload 同步 IPC 已用于防刷新闪烁） | `frontend/src/main.js:43-58` |
| CSP | 无 CSP 头/meta → 插件脚本/样式加载无 CSP 阻塞；file:// 页面 `<link>` 加载 http://localhost 的 stylesheet 不受 CORS 限制（CSS 内 `url()` 相对引用解析到插件 assets 目录，可行） | — |

### 1.4 核心缺口（改造要解决的事）

1. **`registerTheme` 未接入插件生命周期**：安装/启用不注册、卸载/禁用不注销。
2. **主题清单无来源**：`/plugins/slots` 只含 slot，不含主题；后端注册表（`PluginRegistry`）无 theme 维度。
3. **UI 非响应式**：`themePresetList = themePresets` 直接绑定数组引用（`AppearanceSettings.vue:313`），Vue 不追踪 push，插件主题注册后下拉不更新。
4. **启动时序竞态（最大坑）**：`useTheme.ts:115` 模块顶层就 `applyThemePreset(activePreset)`，若持久化主题是插件主题，此刻 `themePresets` 尚未注册（清单是异步拉取）→ `getThemeCssUrl()` fallback 到 `public/themes/{id}.css` → 404、主题丢失。
5. **首帧闪烁残余**：`show:false` 已挡掉大部分，但 `ready-to-show` 可能早于异步 `<link>` CSS 到达；且 `backgroundColor` 固定 `#000000`，浅色主题首帧黑底错配。

---

## 2. 目标架构

```
后端                                   前端渲染进程                          Electron 主进程
┌────────────────────────┐   GET /plugins/slots   ┌──────────────────┐   ┌───────────────────┐
│ PluginRegistry         │ ─────────────────────▶ │ pluginSlots store│   │ createWindow 前预取 │
│  registerSlot (现有)    │  { slots, themes }     │  prepareExternal  │   │ slots+appearance   │
│  registerTheme (新增)   │ ◀──── plugins_changed ─│  registerThemes   │──▶│ sendSync           │
└────────────────────────┘   (SSE diff 刷新)      │  (响应式注册表)    │   │  主题 bootstrap    │
                                                 └────────┬─────────┘   └─────────┬─────────┘
                                                          │ 注册/移除/回退           │ 同步注入
                                                 ┌────────▼─────────┐   ┌─────────▼─────────┐
                                                 │ useTheme         │   │ index.html 内联脚本 │
                                                 │ applyThemePreset │◀──│ dark+data-theme+link│
                                                 └──────────────────┘   └───────────────────┘
                                                          │ 切换时 onload 换 link（现有机制）
                                                          ▼
                                                首帧/切换均无闪烁
```

**设计决策：主题注册走"后端清单驱动"，不依赖插件 IIFE 运行时注册**。理由：
- 主题下拉 UI 与启动应用需要在插件组件加载**之前**拿到元数据与 CSS URL（`pluginSlots.init()` 是异步的，但发生在 `useTheme` 顶层应用**之后**会出现竞态——因此主进程引导与清单预取必须前置，见 §4）；
- 与现有 slot 机制（后端注册 → 前端物化）完全同构，改动最小、语义一致。

---

## 3. 契约设计（后端）

### 3.1 注册 API（`plugin-registry.ts` 扩展）

```ts
// backend-ts/src/modules/plugins/types/plugin.types.ts
export interface ThemeRegistration {
  id: string;                    // 全局唯一（建议 `${pluginId}.${name}` 防冲突）
  name: string;                  // 展示名；支持 i18n key 则同 slots 的 meta 走 NlsService
  nameKey?: string;              // 可选 i18n key
  primaryColor?: string;         // 下拉预览圆点
  secondaryColor?: string;
  mode?: "light" | "dark" | "all"; // 默认 all；cyberpunk/wandering-earth 这类仅暗色可声明
  cssFile: string;               // 相对插件 frontend/dist/ 的文件名，如 "neon.css"
}
```

```ts
// plugin-registry.ts —— 与 registerSlot 并列
registerTheme(pluginId: string, reg: ThemeRegistration) { /* 幂等追加 */ }
getThemes(pluginId: string): ThemeRegistration[]
```

内置插件（如 `builtins/*.plugin.ts`）在 `onModuleInit`/声明式注册里调用 `registerTheme` 即与外部插件走同一契约；内置主题**不需要**迁移，`builtinThemes` 保留作为前端兜底。

### 3.2 清单下发（`plugins.controller.ts:308` 扩展，不改 URL 契约）

`GET /plugins/slots` 响应追加 `themes` 字段（与 slots 同循环、同 enabled 过滤）：

```jsonc
{
  "slots": { /* 现有结构不变 */ },
  "themes": [
    {
      "pluginId": "my-plugin",
      "id": "my-plugin.neon",
      "name": "霓虹",
      "primaryColor": "#0ff",
      "secondaryColor": "#f0f",
      "mode": "dark",
      "cssUrl": "/api/v1/plugins/my-plugin/assets/neon.css?rev=<assetRev>",
      "rev": "<assetRev>"
    }
  ]
}
```

CSS 走**现有** assets 端点（`plugins.controller.ts:347`）——已具备白名单校验 + dist mtime rev 缓存，零新增服务代码。

---

## 4. Electron 可加载性与防闪烁方案（核心）

### 4.1 启动链：主进程引导（bootstrap）

现有 `ready-to-show` + `show:false` 只保证"渲染完成前不显示"，不保证"主题 CSS 就位"。补两层：

1. **主进程预取**：`createWindow()` 前（后端就绪后），主进程向本地后端请求
   `GET /api/v1/plugins/slots` 与 `GET /api/v1/settings/appearance`（缓存，失败降级为 null）。
2. **preload 同步通道**：`contextBridge` 暴露
   `electronAPI.getThemeBootstrap()` → `ipcRenderer.sendSync('theme:bootstrap')`，
   主进程返回 `{ mode, isDark, presetId, cssUrl }`（cssUrl 指向插件 assets 或内置 public 路径）。
3. **index.html 内联脚本**（首个 `<head>` 元素，先于 bundle）：

   ```html
   <script>
     (function () {
       try {
         var b = window.electronAPI && window.electronAPI.getThemeBootstrap();
         if (!b) return;                       // 纯 Web 模式降级：走 useTheme 顶层逻辑
         if (b.isDark) document.documentElement.classList.add('dark');
         if (b.presetId && b.cssUrl) {
           document.documentElement.setAttribute('data-theme', b.presetId);
           var l = document.createElement('link');
           l.rel = 'stylesheet'; l.href = b.cssUrl;
           document.head.appendChild(l);       // 首帧 paint 前同步插入，样式参与首次布局
         }
       } catch (e) { /* 静默降级 */ }
     })();
   </script>
   ```

   浏览器会在首次 paint 前阻塞于该 `<link>`（样式影响布局），配合 `show:false` → **首帧即主题就位，无 FOUC**。

4. **useTheme 幂等**：`applyThemePreset()` 在 bootstrap 已应用同主题时跳过（比对 `data-theme` 与 link href），避免重复请求。

> 为什么不用同步 XHR / 不用在 renderer 里等异步：file:// 页面同步 XHR 受限且会卡主线程；Electron 下 sendSync 走本地 IPC（微秒级），且该模式与 `main.js:43-58` 现有的"同步查后端状态防刷新闪烁"完全一致。

### 4.2 启动时序竞态兜底（Web 模式 & 刷新场景）

内联脚本只覆盖 Electron。Web 模式 / 刷新时仍可能"持久化主题 id 先于清单到达"：

- `applyThemePreset(presetId)` 前先查 `getThemePreset(presetId)`；
- 未注册（未知 id）→ **不发起 `<link>`**，置 pending，由 `pluginSlots.init()` / SSE 清单到达后触发一次补应用（`watch` 注册表）；
- 仍不可解析（插件已卸载的残留 id）→ 回退 default 并清理 localStorage。

### 4.3 切换防闪烁（现状已具备，确认保留）

`applyThemePreset` 的"新 CSS onload 后再移除旧 link + 提前切 `data-theme`"（`themes/index.ts:150-168`）即切换防闪烁，插件主题复用同一函数即自动获得，无需改动。

---

## 5. 前端改造清单

| 文件 | 改动 |
|---|---|
| `frontend/src/themes/index.ts` | ① `themePresets` 改为 `reactive([])`（或抽 Pinia store）并提供 `registerExternalThemes(list)` / `removeThemesByPlugin(pluginId)` / `replaceAll(list)`；② `getThemeCssUrl` 对插件主题走清单内 `cssUrl`（不再 fallback public）；③ 保留 `registerTheme()` 作为单条便捷封装 |
| `frontend/src/stores/pluginSlots.js` | `applySlots` 同时消费 `data.themes`：`replaceAll` 注册；SSE `plugins_changed` 刷新时 diff → 对移除主题做 `removeThemesByPlugin` 并在"当前主题被移除"时回退 default（`useTheme` 联动） |
| `frontend/src/composables/useTheme.ts` | ① `applyThemePreset` 调用前查注册表，未知 id 置 pending；② 监听注册表变更补应用；③ 卸载回退钩子 `onThemeRemoved(id)` |
| `frontend/src/components/setting/AppearanceSettings.vue` | `themePresetList` 改为 storeToRefs/ref 响应式引用（`themePresets` 已 reactive 后自动生效）；`mode: "dark"/"light"` 主题在非对应模式下置灰或提示"仅暗色" |
| `frontend/index.html` | 插入 §4.1 内联脚本 |
| `frontend/src/main.js` | （可选强化）Electron 下 `createApp().mount()` 前 `await pluginSlots.init()`，使插件主题在首次渲染前注册 |

---

## 6. 生命周期联动

| 事件 | 行为 |
|---|---|
| 安装插件（含主题） | `plugins_changed` SSE → `replaceAll` 注册 → 下拉立即可选 |
| 启用/停用 | 同 slots 走 enabled 过滤，停用即从清单消失 → 注册表移除 |
| 卸载插件 | 移除主题注册；**若当前生效主题来自该插件 → 回退 default + ElMessage 提示**；localStorage 中残留 id 由 §4.2 兜底清理 |
| 插件更新 | `rev` 变化 → assets URL 变化 → 当前生效主题的 `<link>` 应替换为新 rev（监听清单变更，同主题换 URL 重载） |
| 命名冲突 | 主题 id 建议 `${pluginId}.${name}`；`registerTheme` 已有去重（`themes/index.ts:114`），冲突时后者覆盖或报错（建议报错 + 前端提示） |

---

## 7. 风险与边界

| 风险 | 级别 | 说明/对策 |
|---|---|---|
| 启动竞态（持久化插件主题在清单前应用） | 高 | §4.2 pending + 补应用 + 回退兜底；Electron 走 §4.1 内联脚本彻底规避 |
| 首帧 FOUC | 中 | 内联脚本 + `show:false` + `backgroundColor` 保持暗色（或按 bootstrap 动态化） |
| file:// 页面跨源加载 http CSS | 低 | stylesheet 加载无 CORS 限制，Chromium 允许；**CSS 内 `url()` 资源需相对 assets 目录引用**（写入主题开发约定） |
| 未来加 CSP | 低 | 若将来加 CSP，`style-src` 需含 `'unsafe-inline'`（内联脚本/样式）与 `http://localhost:*`（插件 CSS）；当前无 CSP，无阻塞 |
| 插件主题注入恶意样式 | 低 | 与插件前端产物同信任域（本机插件市场），不做额外 CSS 消毒；与现有 slot 组件信任模型一致 |
| `backgroundColor` 与浅色主题错配 | 低 | 保持 `#000000` 时内联脚本已保证首帧主题就位，黑底不可见；可进一步按 bootstrap.isDark 动态设置 |

---

## 8. 分阶段实施计划

### 阶段 1：契约 + 注册表（后端 + 主题核心）
- `plugin.types.ts` 增加 `ThemeRegistration`；`plugin-registry.ts` 增加 `registerTheme/getThemes`
- `plugins.controller.ts` slots 响应追加 `themes`（含 cssUrl + rev）
- `themes/index.ts` 响应式化 + `registerExternalThemes/removeThemesByPlugin`；`useTheme.ts` pending/补应用/回退钩子
- 内置插件示例：把 1 个内置主题改为经 `registerTheme` 声明走通全链路（验证契约）

### 阶段 2：生命周期 + UI
- `pluginSlots.js` 消费 themes、SSE diff、卸载回退
- `AppearanceSettings.vue` 响应式列表 + mode 置灰
- Web 模式端到端验证：安装/启停/卸载插件 → 主题出现/消失/回退

### 阶段 3：Electron 防闪烁
- `electron/main.ts` 主进程预取 + `ipcMain.on('theme:bootstrap')`
- `electron/preload.ts` 暴露 `getThemeBootstrap()`（sendSync）
- `frontend/index.html` 内联脚本；`main.js` 挂载前 `await pluginSlots.init()`
- 验证：暗色系统 + 插件暗色主题冷启动无白闪；浅色主题冷启动无黑底帧；主题切换无闪烁

---

## 9. 改动文件汇总

```
backend-ts/src/modules/plugins/types/plugin.types.ts        (+ThemeRegistration)
backend-ts/src/modules/plugins/registry/plugin-registry.ts  (+registerTheme/getThemes)
backend-ts/src/modules/plugins/plugins.controller.ts        (slots 响应 +themes)
backend-ts/src/modules/plugins/builtins/*.plugin.ts         (示例：内置主题改声明式)   [可选]
frontend/src/themes/index.ts                                (响应式注册表 + 插件主题 URL 解析)
frontend/src/stores/pluginSlots.js                          (消费 themes + SSE diff + 回退)
frontend/src/composables/useTheme.ts                        (pending 补应用 + 卸载回退)
frontend/src/components/setting/AppearanceSettings.vue      (响应式列表 + mode 置灰)
frontend/index.html                                         (+内联 bootstrap 脚本)
frontend/src/main.js                                        (挂载前 await slots init) [Electron]
electron/main.ts                                            (主进程预取 + theme:bootstrap IPC)
electron/preload.ts                                         (+getThemeBootstrap sendSync)
```

核心改动 5 个文件（注册表/清单/UI/useTheme/pluginSlots）+ Electron 3 处，内置主题与现有插件协议零破坏。

---

## 10. 实施记录（2026-09-01 已完成）

### 阶段 1：契约 + 注册表
- `plugin.types.ts` 新增 `ThemeRegistration`（id/name/nameKey/primaryColor/secondaryColor/mode/cssFile）
- `plugin-registry.ts` 新增 `themes` 维度 + `registerTheme/getThemes/getAllThemes`（registerSlot 同模式，幂等）
- `plugin-api.ts` 新增 `registerTheme` 接口 + `_themes` 字段 + flush（插件声明式入口）
- `plugins.controller.ts` `GET /plugins/slots` 响应追加 `themes` 数组（enabled 过滤、NLS name 解析、cssFile + rev）
- 契约测试 `plugin-theme.contract.spec.ts`：5/5 通过（幂等/隔离/清理/下发/禁用过滤）

### 阶段 1b：前端注册表响应式化 + pending 兜底
- `themes/index.ts` 重构：`themePresets` 改 `reactive([])`；新增 `registerExternalTheme`（幂等覆盖+URL 更新+version++）、`removeThemesByPlugin`（返回被移除 id）、`replaceThemesByPlugin`（applySlots 全量语义，pending 命中时同步补应用）；`applyThemePreset` 增加 appliedPresetId 幂等 + 未知 id 置 pending（不再发错误请求）；`themeRegistryVersion` 版本信号
- `useTheme.ts`：`watch(() => themeRegistryVersion.value, retryPendingTheme)`（deep 陷阱规避：getter 形式）

### 阶段 2：生命周期 + UI
- `pluginSlots.js`：`applySlots(slots, themes)` 双参数；`syncThemes` 全量 diff（清单内 replace / 清单外 remove）；`themeCssUrl` 复用 apiService.baseURL 拼 assets URL；`fallbackIfActiveThemeRemoved` 当前主题被移除时回退 default + ElMessage 提示；`removePlugin`/`watchRefresh` 同步处理 themes
- `AppearanceSettings.vue`：`themeUnavailable()` 对 mode=dark/light 主题置灰（themePresets 已 reactive，下拉自动响应插件增删）
- `main.js`：`ensureThemeReady()` 挂载前 `await pluginSlots.init()`（Web/Electron 统一）；waitBackendReady 回调补一次 init（冷启动后端未就绪时挂载前 init 失败的兜底）

### 阶段 3：Electron 防闪烁
- 实现方式修订：弃用"主进程 HTTP 预取 + sendSync bootstrap"（sendSync 无法同步等后端），改为**窗口显示延迟 + 渲染进程就绪信号**
- `electron/main.ts`：`theme-ready` IPC（记录 `themeReadyReceived` 防先于 ready-to-show 到达丢信号）；`ready-to-show` 后等 `theme-ready` ≤2s 再 show；`createWindow` 开头重置信号（窗口重建防残留）
- `electron/preload.ts`：暴露 `sendThemeReady()`
- `frontend/index.html`：内联同步脚本，bundle 前应用 dark class + data-theme（首帧 CSS 变量就位，防白底/暗底错配）
- 时序保证：bundle → useTheme 顶层 apply（插件主题 pending）→ 挂载前 init → 主题注册 → replaceThemesByPlugin 同步补应用（link 插入）→ sendThemeReady → 主进程 show → 首帧即主题就位

### 阶段 3b：防闪烁方案二次修订（2026-09-02）——加载页兜底，退役 theme-ready 握手
- 决策：项目已有完整加载页机制（`/empty` 路由 → `BackendWaitingOverlay.vue`，`main.js:163-166` + 路由守卫 `main.js:177-184` 强制重定向 + `waitBackendReady` 自动跳回），启动阶段明确是"加载中"视觉，**无需**启动首帧即主题化
- 原理：防闪烁防的是"用户看内容时颜色突变"，加载页（纯 CSS 变量 fallback，不依赖主题 CSS）天然消解该风险；主页面首帧正确由"跳转前主题就绪"保证
- 核心改动 `main.js`：`waitBackendReady` 回调调整时序——`await ensureThemeReady()`（清单+CSS 就绪）→ `backendReady.value = true`（放行守卫）→ 跳回主页面；backendReady 置位必须在 await 之后，避免守卫（`main.js:186-193`）提前放行导致主题未就绪
- 退役：`electron/main.ts` 删除 theme-ready IPC/themeReadyReceived/themeReadyResolve/2s 超时，恢复 `ready-to-show` 即 `show()`（显示加载页）；`electron/preload.ts` 删除 `sendThemeReady`；`main.js` 删除挂载前 `sendThemeReady` 调用（保留 `ensureThemeReady().then(mount)`）
- 保留：`index.html` 内联明暗脚本（加载页也分明暗，零成本）；`main.js` 挂载前 init 与 waitBackendReady 补 init 兜底
- 收益：代码量减少；冷启动"加载页 → 主题就绪 → 主页面首帧正确"全程无闪烁；方案 1（缓存注册表）因加载页兜底而不再必要（未来"离线启动/清单变大"再议）

### 验证
- 后端 `tsc --noEmit` 通过；契约测试 5/5
- 前端 `vue-tsc --noEmit`：改动文件零错误（既有错误 30 行与此改动无关）
- `vite build` 通过（需 `NODE_OPTIONS=` 绕过 WorkBuddy safe-delete shim）；dist/index.html 内联脚本保留
- Electron `tsc --noEmit` 通过

### 遗留 / 注意事项
- 插件主题 CSS 内 `url()` 相对资源以 CSS 文件位置为基准解析，可引用**插件目录内**任意受支持扩展名资源（阶段 4b 后，不限于 frontend/dist；越出插件目录的相对路径不会被服务）
- 插件主题 id 建议 `${pluginId}.${name}` 防跨插件冲突（registerTheme 已有同 id 覆盖语义）

### 阶段 4：内置主题插件化迁移（2026-09-02 已完成）——端到端实测 + 第三方参考范例
- **新建 `plugins/guada-themes/`**（category=system，默认启用且不可禁用）：`onLoad` 里 `api.registerTheme()` × 10，id 沿用原内置 id（用户 localStorage 持久化设置无缝衔接），cssFile 指向 `frontend/dist/` 下扁平文件名
- **CSS 产物**：10 个主题 CSS 从 `frontend/public/themes/` 复制至 `plugins/guada-themes/frontend/dist/`（assets 端点白名单 `[A-Za-z0-9_-]+\.css`，不支持子目录）；`famicom` 字体（唯一相对引用 `url('../fonts/...')`）已内联为 `data:font/woff2;base64`（12KB woff2 → ~16.7KB）
- **前端**：`themes/index.ts` builtinThemes 仅保留 default；`getThemeCssUrl` fallback 路径标注不可达；删除 `frontend/public/themes/*.css` 与 `frontend/public/fonts/`
- **环境与基础修复**：
  - `backend-ts/.env`：`PLUGINS_DEV_DIR=plugins-dev`（backend-ts 下空目录）→ `../plugins`（项目根，hello-plugin 与 guada-themes 所在）
  - `external-plugin-loader.ts`：`loadExternalPlugin` 开头 `pluginDir = path.resolve(pluginDir)`——原相对路径（`../plugins`）经 `require()` 按**当前模块文件**解析导致 `Cannot find module`（hello-plugin 此前从未成功加载，属既有 bug）
  - 后端启动 node 版本：**node 25 匹配** better-sqlite3（NODE_MODULE_VERSION 141）；shell 默认 node 22（127）会报 ABI 不匹配。启动：`PATH="/d/Program Files/nodejs:$PATH" npm run start:dev`
- **端到端验证（真实后端）**：`GET /api/v1/plugins/slots` 返回 `themes: 10`（guada-themes 全部主题，含 cssFile/rev）；`GET /plugins/guada-themes/assets/cyberpunk.css` → 200 text/css；famicom.css 含 `data:font/woff2;base64` 且无 `../fonts` 残留；契约测试 5/5
- **第三方参考**：`plugins/guada-themes/index.js` 即最小完整范例（registerTheme 声明 + CSS 产物布局 + 自包含约束；纯 JS 无依赖，随包分发形态）

### 阶段 4b：assets 契约修订为「相对插件根」（2026-09-02 已完成，方案 A）
- **动机**：原契约硬编码 `frontend/dist` 扁平文件名（`[A-Za-z0-9_-]+\.(js|css)`，无子目录、无字体/图片），主题资源被迫塞进 slot 产物目录、famicom 字体被迫内联
- **新契约**（`plugins.controller.ts getPluginAsset`）：基路径 = 插件**扫描记录的真实目录**（`getPluginPath`，非插件声明）；`assetPath` 为**相对插件根**的受约束子路径，解码后字符白名单 `^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(css|js|mjs|json|woff2|woff|ttf|otf|png|jpg|jpeg|gif|svg|webp)$`（无 `.`/`..`/`\`/空段，物理上杜绝穿越）+ resolve 后前缀校验纵深防御；扩展名映射 Content-Type
- **路由坑（重要）**：NestJS 11 / Express 5 命名通配 `*assetPath` 对多段路径捕获异常——`@Param` 得到 `"themes,cyberpunk.css"`（逗号拼接）。**必须从 `req.originalUrl` 手动截取 assets/ 之后路径**（先例 `html-preview/*filePath` 同样存在此坑，从未用于多段）
- **slot 组件**：产物仍在 `frontend/dist`，前端 `prepareExternal` URL 补 `frontend/dist/` 前缀（相对插件根语义）
- **guada-themes**：CSS 移至插件根 `themes/`（cssFile = `themes/xxx.css`）；famicom 字体**去内联**恢复为 `themes/fonts/press-start-2p.woff2`（12512B 与原始一致），CSS 改回相对引用 `url('fonts/press-start-2p.woff2')`
- **assetRev** 改递归扫描插件全目录（主题移出 frontend/dist 后 rev 仍能感知变化）
- **dotfiles 坑（2026-09-02 修复）**：`res.sendFile` 默认 `dotfiles: 'ignore'`，拒绝路径中点开头段——用户插件目录（如 `C:\Users\22071\.guada-dev\plugins`）下的插件资产 sendFile 一律 404（文件存在也 404）。`sendFile(filePath, { dotfiles: "allow" }, cb)` 放行（插件资产服务场景必须显式设置）
- **验证**：`assets/themes/cyberpunk.css` → 200 text/css；`assets/themes/fonts/*.woff2` → 200 font/woff2；编码穿越 `themes/..%2f..%2fwin.ini` → 403；`%2e%2e` 段 → 404（路由层归一化）；**点目录插件资产（example_plugin @ .guada-dev）→ 200**；契约测试 5/5；前端 vite build 通过

- **生产部署缺口**（plugins/ 需打包 + 插件入口需可在纯 Node 加载）已于 2026-10-08 修复，见下节

### 主题表面 token 派生约定（2026-10-20）
- `--gd-color-surface-subtle` / `--gd-color-surface-subtle-hover` **不要求主题单独定义**：`frontend/src/style.css` 中由 `color-mix(in srgb, var(--gd-color-text) N%, var(--gd-color-surface))` 派生（亮色 3.5% / 5.5%，暗色 6.8% / 12%）。主题覆盖 `--gd-color-surface` / `--gd-color-text` 后自动跟随，新增主题无需额外适配。
- 需要特殊色感时，可在主题的亮色块 `[data-theme="id"]` 或暗色块 `html.dark[data-theme="id"]` 显式覆盖这两个变量；仅亮色/仅暗色主题只写对应块。
- 注意特异性：`html.dark`（0,1,1）会压过 `[data-theme="id"]`（0,1,0），所以暗色覆盖必须写在 `html.dark[data-theme="id"]` 里。

### 生产部署缺口（2026-09-02 识别，**2026-10-08 已修复**）

**现象**：dev 模式（ts-node-dev）下插件链路已端到端验证通过；但 **Electron 打包生产版主题会消失（只剩 default）**。三个根因叠加：

1. **打包不含插件目录**：`package.json` `build.extraResources` 未包含项目根 `plugins/`（当时的清单只有 backend-ts/dist、node_modules、static、build-resources；随包数据目录 `bundled-skills` / `bundled-agents` / `bundled-providers` 同样漏了，2026-10-12 补齐，见 `backend-ts/test/packaging/electron-packaging.spec.ts`）
2. **生产模式插件目录为空**：`electron/main.ts` 生产 spawn env 只注入 `PLUGINS_USER_DIR`（userData/plugins，安装后为空），未注入指向随包资源的插件目录
3. **生产无法加载 .ts 插件入口**：生产后端以纯 Node 运行 `backend-ts/dist/main.js`（无 ts-node hook），而外部插件入口是 `index.ts`（dev 靠 ts-node-dev 的 transpile hook 编译）；且插件 `import "../../backend-ts/src/modules/plugins"` 依赖源码路径，打包后仅存在 `dist/` 无 `src/`

**实际采用的修复**（较原方案 A 更简：不再随包分发 backend-ts/src，插件入口去依赖即可）：

- ① 插件入口改写为**零依赖 CommonJS** `plugins/guada-themes/index.js`（普通类 + `manifest` + `onLoad(api)`；loader 支持「CommonJS 直出类」，无需继承 PluginBase），`manifest.main` 指向 `index.js`，删除 `index.ts`
- ② `ExternalPluginLoader` 新增 **builtin 扫描来源**（env `PLUGINS_BUILTIN_DIR`），扫描顺序 builtin → user → dev（官方 system 插件不被用户副本遮蔽）；`getPluginSource` 返回 `builtin`，卸载被拒（随包目录只读）
- ③ `electron/main.ts` 生产 spawn env 注入 `PLUGINS_BUILTIN_DIR = <resourcesPath>/plugins`
- ④ `package.json` `extraResources` 增加 `{ from: "plugins/guada-themes", to: "plugins/guada-themes" }`
- **验证**：`test/plugins/guada-themes-packaging.spec.ts`（3 例：入口为纯 JS 且不依赖 backend 源码、按 builtin 加载注册全部主题且 CSS 均存在、扫描顺序）；`electron-builder --dir` 后确认 `resources/plugins/guada-themes/`（index.js + manifest.json + 11 个 CSS + 字体）随包分发
- 原方案 B（首启复制到 user 目录）未采用：随包目录只读更安全，也避免与市场安装的同名插件互相覆盖
- 后续（非阻塞）：若插件生态成熟，可把 PluginBase/PluginApi 移到稳定导出路径供第三方 import
