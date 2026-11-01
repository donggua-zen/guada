# GdToast 轻提示规范 + 动效阶梯

## GdToast

### 结论

命令式轻提示只有一套自研基座，零 Element Plus 依赖：

- **服务层** `frontend/src/components/ui/toastService.ts`：模块级命令式 API（modalService 纯模块、Pinia store、组件内都可调）。
- **渲染层** `frontend/src/components/ui/GdToastHost.vue`：挂 `App.vue`（GdDialogHost 同位置），Teleport body + `TransitionGroup` 堆叠动画。
- `ElMessage`（187 处真实调用/41 文件）、`ElNotification`（64 处，全经 usePopup.notify）、`v-loading`（1 处）已全量移除。
- ESLint 禁止从 `element-plus` 导入 `ElMessage` / `ElNotification` / `ElLoading`。

### 服务 API（toastService.ts）

```ts
import { toast, notify, pushToast, closeAllToasts } from '@/components/ui/toastService';

toast.success(content)            // 2000ms
toast.error(content)              // 3000ms，带关闭钮
toast.warning(content)            // 2500ms
toast.info(content)               // 2000ms
const h = toast.loading(content)  // 常驻，h.close() 手动关
notify.error(title, content)      // 标题加粗首行 + 正文两行，5000ms

pushToast({ type, title?, content, duration?, showClose? })  // 全量形态，返回 { id, close() }
closeAllToasts()
```

- 堆叠上限 5 条，超出自动收最旧的。
- `visible` 标记驱动 leave 动画，200ms 后出队（Host 的 transition 时长一致）。
- 模块级 `shallowReactive` 队列（照 modalService 范式）。

### 视觉

- 顶部居中堆叠（`--gd-z-element: 4000`，与原 `app.use(ElementPlus,{zIndex:4000})` 同值语义）。
- 毛玻璃面板（对齐 GdPopover 面板语言）+ `gd-toast` 基类 + `data-type` 主题钩子。
- 语义色图标与 GdDialogHost 弹窗图标同一套 token（success/warning/danger/info）；loading 用内联 spinner。
- 进出场：`translateY(-8px) scale(0.97)` + opacity，easing `--gd-motion-ease-toast`；`move` 过渡处理堆栈上移。

### usePopup 兼容层

`usePopup().toast/notify/loading` 签名完全不变（内部已改调 toastService），250+ 处业务调用零改动；`closeAll()` 现在同时清 toast 与弹窗（原实现漏了 ElNotification，已补齐）。

## 动效阶梯（style.css `--gd-motion-*`）

| Token | 值 | 用途 |
|---|---|---|
| `--gd-motion-duration-fast` | 120ms | tooltip、小控件 |
| `--gd-motion-duration-base` | 200ms | popover / dropdown / switch 默认 |
| `--gd-motion-duration-slow` | 300ms | 大面板 |
| `--gd-motion-ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | 入场 |
| `--gd-motion-ease-in-out` | cubic-bezier(0.65, 0, 0.35, 1) | 双向 |
| `--gd-motion-ease-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | 回弹（switch thumb 短行程） |
| `--gd-motion-ease-toast` | cubic-bezier(0.77, 0, 0.175, 1) | toast 进出场 |

`prefers-reduced-motion: reduce` 有 style.css 末尾的全局兜底（transition/animation 即时到位），新组件无需逐个处理。

### 各组件动效接线

- **GdSwitch**：thumb `transition-transform` + `ease-spring` 回弹（短行程末端带回弹感）。
- **GdPopover**：`updatePosition()` 把弹出方向写进根元素 `data-show-above`；进出场 4px 方向位移（下方弹出从 -4px 落下、上方从 +4px 升起），position 模式（级联）退化为纯淡入淡出。
- **DropdownMenu**：同样按弹出方向（`data-above`）分支 4px 位移 + scale(0.96)。
- **ContextMenu**：fast 档 `scale(0.96) translateY(-2px)`，transform-origin top left（右键菜单从触发点展开）。
- **GdTooltip**（tooltip.ts 单例）：`display` 直切改 `--visible` class 切换（opacity + 2px 上移，fast 档）；测量定位用 `visibility:hidden` 不影响布局。
- **GdDialog**：原有 `--gd-motion-duration-dialog/ease-dialog` 不变（最早 token 化的组件）。
