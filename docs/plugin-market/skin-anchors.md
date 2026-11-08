# 皮肤语义锚点（data-gd-slot）

> v3 起「皮肤」已并入「主题」：富主题（`runtimeScript` / `assetBase`）通过同一套锚点做结构覆盖。
> 详见 `theme-skin-unification.md`。

> 皮肤（skin）插件通过 CSS 覆盖宿主外观。为了不依赖内部 class 名（Vue scoped / Tailwind 会随重构变化），
> 宿主在关键结构上暴露**稳定的语义锚点**。皮肤只应针对这些锚点写选择器。

## 锚点清单

| 锚点 | 位置 | 文件 | 用途 |
|---|---|---|---|
| `data-gd-slot="sidebar"` | 侧边栏容器（含设置侧栏 portal） | `components/MainLayout.vue` | 侧栏背景/花边/会话列表装饰 |
| `data-gd-slot="content"` | 右侧主内容卡片 | `components/MainLayout.vue` | 背景层、内容区边框 |
| `data-gd-slot="titlebar"` | 页面标题栏（`PageHeader`） | `components/PageHeader.vue` | 顶栏装饰、品牌位 |
| `data-gd-slot="conversation"` | 消息 + 输入区容器 | `components/chat/ChatPanel.vue` | 对话背景、立绘舞台 |
| `data-gd-slot="composer"` | 输入区（sticky 底部容器） | `components/chat/ChatPanel.vue` | 输入区整体留白/背景 |
| `data-gd-slot="composer-card"` | **输入卡片本体**（带圆角/边框的那层） | `components/chat/ChatInput.vue` | 输入框相框/描边/阴影（用 `::before` 装饰） |
| `data-gd-slot="message"` | 单条消息（turn 外壳） | `components/chat/TurnItem.vue` | 消息气泡样式 |
| `data-gd-slot="landing"` | 欢迎页 | `components/chat/WelcomeScreen.vue` | 着陆页构图 |
| `data-gd-slot="settings"` | 设置页容器 | `components/setting/SystemSettings.vue` | 设置面板装饰 |
| `data-gd-slot="overlay"` | 全局浮层锚点 | `components/MainLayout.vue` | 皮肤自建的全屏层定位上下文 |

## 使用约定

1. **皮肤 CSS 的作用域**：所有选择器以 `body[data-gd-skin-<id>]` 开头（宿主在启用时打到 `body`）。
2. **只依赖锚点 + token**：结构用 `[data-gd-slot='x']`，颜色/圆角/阴影用 `--gd-*` 变量。
3. **不依赖内部 class**：`[class*='sidebarCol']` 这类写法会在重构后静默失效。
4. **亮/暗**：宿主用 `html.dark` 表示暗色；皮肤可用 `html.dark body[data-gd-skin-x]` 区分。
5. **新增锚点**：只加在"语义稳定"的容器上；不要给每个内部元素都打标记。

## 示例

```css
/* 侧栏底色 */
body[data-gd-skin-demo] [data-gd-slot='sidebar'] {
  background: var(--gd-color-sidebar-bg);
}

/* 暗色下的对话区背景图 */
html.dark body[data-gd-skin-demo] [data-gd-slot='conversation'] {
  background-image: url('/api/v1/plugins/demo/assets/bg-dark.webp');
}

/* 输入框相框 */
body[data-gd-skin-demo] [data-gd-slot='composer'] .chat-column {
  border-image: url('/api/v1/plugins/demo/assets/composer-frame.webp') 12 fill;
}
```

## 皮肤运行时脚本契约

皮肤可在 `runtimeScript` 里注册钩子（IIFE，执行后调用）：

```js
window.__GuaDaSkin__ = function (api, manifest) {
  // api.assetUrl('bg.webp')  → 同源资源 URL
  // api.own(node)            → 登记自建节点，卸载时自动移除
  // api.setBodyAttribute(k,v) / api.setCssVariable(k,v) → 自动还原
  // api.getSetting('x') / api.onSettingChange(cb)
  // api.isDark() / api.onModeChange(cb)
  const stage = document.createElement('div');
  stage.className = 'demo-stage';
  api.own(stage);
  api.setCssVariable('--demo-art', `url(${api.assetUrl('art.webp')})`);
  return () => {
    /* 自定义清理（可选；owned 节点与 CSS 变量由宿主还原） */
  };
};
```

宿主保证：卸载时移除自建节点、还原 body 属性与 CSS 变量、移除 `<link>`/`<script>`。
