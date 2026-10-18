# 弹窗统一规范

## 结论

全项目只有一套模态框基座：`frontend/src/components/ui/GdDialog.vue`。

- 声明式弹窗：业务组件直接使用 `<GdDialog>`。
- 命令式弹窗：`usePopup.confirm / prompt / editText / dialog / alert`，内部委托 `modalService` + `GdDialogHost`，最终仍由 `GdDialog` 渲染。
- Element Plus 仅保留表单控件、`ElMessage` / `ElNotification` 轻提示，以及 `TaskLogDrawer` 的 `ElDrawer`（唯一例外）。

禁止新增 `<el-dialog>`、`ElDialog`、`ElMessageBox`。ESLint 已对 `ElMessageBox` / `ElDialog` 的导入做限制。

## 架构

```
业务组件
  ├─ <GdDialog>                                 声明式
  └─ usePopup.confirm / prompt / alert ...       命令式门面
            ↓
      modalService.openModal(options)
            ↓
      GdDialogHost（App.vue 挂载一次，队列 + 离场动画）
            ↓
         GdDialog（唯一模态基座）
```

## 尺寸档位

新代码只使用 `size`，不再写 `width`。

| size | 宽度 | 用途 |
|---|---|---|
| `xs` | 400px | confirm / alert / prompt、小型选择器 |
| `sm` | 480px | 简单表单、重命名、移动 |
| `md` | 600px | 标准表单（默认） |
| `lg` | 760px | 内容较多、列表选择 |
| `xl` | 900px | 编辑器、智能体配置 |
| `full` | `min(1200px, calc(100vw - 32px))` | 预览、会话详情 |

`width` 仅作为逃生口保留，新代码不应使用。

## 视觉令牌

定义在 `frontend/src/style.css`：

| Token | 说明 |
|---|---|
| `--gd-dialog-width-*` | 尺寸档位 |
| `--gd-color-dialog-bg` / `-border` | 面板底色与边框 |
| `--gd-color-overlay-bg` + `--gd-dialog-overlay-opacity` | 遮罩 |
| `--gd-dialog-shadow` | 面板阴影（亮/暗两套） |
| `--gd-dialog-padding-x` / `-y` | 内边距 |
| `--gd-dialog-title-size` / `-weight` | 标题排版 |
| `--gd-dialog-gap` | 底部按钮间距 |
| `--gd-motion-duration-dialog` / `--gd-motion-ease-dialog` | 动画 |
| `--gd-size-dialog-rounded-radius` | 圆角 |

主题插件继续覆盖 `.l-dialog` 与 `--gd-*` 即可生效；`GdDialog` 同时输出 `gd-dialog` 类名作为新主题钩子。

## 行为规范

| 行为 | 规范 |
|---|---|
| ESC | 仅最上层弹窗响应；焦点在弹窗内时可靠 |
| 焦点 | 打开时聚焦 `[autofocus]` 或第一个可聚焦元素；Tab 在弹窗内循环；关闭后归还焦点 |
| 滚动锁 | 引用计数，多弹窗嵌套安全 |
| 遮罩点击 | 声明式默认关闭；命令式 confirm/alert/prompt 默认不关闭 |
| 离场动画 | 200ms，`opacity + translateY + scale` |
| `destroyOnClose` | 默认 `true`，关闭后销毁内容，保持「关闭即重置表单」的既有行为 |
| `appendToBody` | 默认 `true`，避免被 webview / stacking context 覆盖 |
| 层级 | `GdDialog` 从 2000 起按打开顺序递增 |

## 层级

| Token | 值 | 用途 |
|---|---|---|
| `--gd-z-modal` | 2000 | 弹窗遮罩 |
| `--gd-z-popover` | 3000 | `GdPopover` / `DropdownMenu` |
| `--gd-z-element` | 4000 | Element 浮层（`app.use(ElementPlus, { zIndex: 4000 })`） |
| `--gd-z-context-menu` | 4500 | 右键菜单 |
| `--gd-z-drag-mask` | 9000 | 拖拽遮罩 |

## 命令式 API

```ts
const { confirm, prompt, alert, editText } = usePopup()

const ok = await confirm('删除会话', '确定删除？', { type: 'warning', danger: true })
const name = await prompt('重命名', { defaultValue: 'old', required: true })
await alert('提示', '操作完成')
const text = await editText({ title: '编辑内容', rows: 8 })
```

需要 VNode、异步校验或自定义按钮时直接使用 `openModal`：

```ts
import { openModal } from '@/components/ui/modalService'

const result = await openModal({
  title: '选择打开方式',
  content: url,
  icon: 'info',
  size: 'xs',
  confirmText: '内置浏览器',
  cancelText: '外部浏览器',
  closeOnClickModal: false,
})
// result.action: 'confirm' | 'cancel' | 'close'
```

## 例外

- `TaskLogDrawer.vue` 仍使用 `ElDrawer`。抽屉不是模态框，暂不纳入 `GdDialog`；其底色与内边距通过全局 `--el-drawer-*` 桥接跟随主题。注意 Element 浮层起始层级为 4000，高于 `GdDialog` 的 2000 层级；当前日志抽屉内部没有确认框，若未来需要在抽屉里弹确认框，应先把抽屉迁移到 `GdDialog` 体系。
- `ElMessage` / `ElNotification` 仍是轻提示实现，统一从 `usePopup` 的 `toast` / `notify` 调用。
