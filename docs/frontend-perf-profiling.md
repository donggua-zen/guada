# 前端性能统计（opt-in）

用于量化聊天渲染链路的耗时与次数，默认关闭；关闭时只有一次布尔判断，不采样、不启动
`PerformanceObserver` / rAF。

实现：`frontend/src/utils/perf.ts`（纯聚合器 + 浏览器监控）。
指标只保存数字，样本环形缓冲上限 512，不持有块/字符串引用。

## 开启与关闭

| 方式 | 说明 |
|---|---|
| URL `?perf=1` | 本次页面加载开启 |
| URL `?perf=0` | 关闭并清除 localStorage 持久开关 |
| `localStorage.setItem('gd:perf','1')` + 重启 | 打包版 / Electron 持久开启 |
| 控制台 `__gdPerf.enable()` | 运行时开启 |
| 控制台 `__gdPerf.disable()` | 运行时关闭 |
| 控制台 `__gdPerf.help()` | 打印用法 |

常用命令：

```js
__gdPerf.reset()       // 切换场景前清空
__gdPerf.report()      // console.table 打印并返回结构化报告
__gdPerf.snapshot()    // 只返回报告，不打印
__gdPerf.exportJSON()  // 导出 JSON 字符串（可保存做前后对比）
```

## 指标

| 指标 | 含义 |
|---|---|
| `replay.foldEvents` | 历史事件全量重折耗时；meta：`reason`(initial/load-more/bot)、`events`、`turns` |
| `live.chunk.<type>` | 每类 SSE chunk 的投影耗时与次数（`text_delta` / `reasoning_delta` / `tool_call_delta`…） |
| `replay.fetch` | 历史事件页网络耗时；meta：`events`、`initial` |
| `replay.stashApply` | 无缓存期间暂存事件的消费耗时 |
| `session.detailFetch` | 切换会话时拉会话详情（设置/子会话）的耗时 |
| `session.contextStats` | 打开会话后逆向扫描事件日志填上下文圆环的耗时 |
| `session.listMount` | 骨架屏隐藏 → 消息列表 patch 完成（nextTick）；meta：`turns` |
| `session.listPainted` | 骨架屏隐藏 → 首次绘制（double rAF，250ms 兜底；后台标签页 rAF 暂停时用兜底） |
| `session.listUnmount` | 骨架屏出现 → 旧列表卸载完成（nextTick） |
| `group.build` | `groupContentsForDisplay` 分组构建；meta：`blocks`、`groups` |
| `markdown.parse` / `markdown.diff` | 流式更新时的同步 Markdown 解析、diff-dom；meta：`chars` / `html` |
| `markdown.initial.parse` / `markdown.initial.dom` | 挂载首渲染的同步解析、`innerHTML` 写入；meta：`chars` |
| `outline.recompute` | 大纲 `outlineItems` 重算；meta：`turns` |
| `fileChanges.compute` | 回合级文件变更聚合（每个 write/edit 跑一次 `diffLines`）；meta：`blocks`、`edits`、`chars` |
| `diff.countLines` | `countDiffLines` 单次行级 diff；meta：`oldChars`、`newChars` |
| `thinking.preview` | 思考摘要（`split('\n')` 全文）；meta：`chars` |
| `turnItem.deepWatch` | 分组 deep watch 触发次数（纯计数） |
| `scroll.groupBody` / `scroll.bottom` | 两处贴底布局读写耗时 |
| `toolCalls.rowDisplays` / `toolCalls.rendererInfos` | 工具行 computed 重算（含 `partialParse`）；meta：`calls` |
| `vue.<Component> mount` / `init` / `render` / `patch` | Vue 内置组件阶段 measure（需 `app.config.performance`）：同步挂载总耗时、setup、渲染函数、子树 patch；`mount`/`patch` 含子组件 |

报告还会附带：长任务次数与阻塞总时长（≥50ms）、平均 FPS、JS 堆内存（Chromium）、DOM 节点数。

> FPS 只在窗口可见时采样（浏览器会暂停后台 tab 的 `requestAnimationFrame`）；
> 在后台/隐藏窗口里显示为 0 属于预期，不代表渲染卡顿。

## 会话打开链路 trace

开启统计后切换会话，控制台会输出一组带相对毫秒的阶段日志，结束时再打印一张 `stepMs` 汇总表：

```
[session-open#3] begin session=01K...
[session-open#3] +0ms route:update-start
[session-open#3] +120ms detail:start
[session-open#3] +480ms detail:end
[session-open#3] +500ms panel:watch-fired
[session-open#3] +510ms panel:start
[session-open#3] +512ms panel:cache-gate | loaded=1 turns=31 events=866
[session-open#3] +512ms panel:cache-hit
[session-open#3] +515ms panel:load-messages-done
[session-open#3] +516ms panel:context-stats-done
[session-open#3] +516ms panel:loading-false
[session-open#3] +1016ms panel:skeleton-hide-scheduled | elapsed=0 remaining=500
[session-open#3] +1516ms panel:skeleton-hidden | turns=31 visibleTurns=31
[session-open#3] +3890ms panel:list-patched | turns=31 visibleTurns=31
[session-open#3] +3920ms panel:list-painted
[session-open#3] +3920ms done
```

关键判断：

- `panel:cache-gate` 里 `loaded=1` 且之后没有 `replay.foldEvents` → 确认走的是本地缓存，没有网络/回放成本。
- `panel:skeleton-hidden` → `panel:list-patched` 的差值 = Vue 挂载整棵消息列表（TurnItem + MarkdownContent）的同步成本。
- `panel:list-patched` → `panel:list-painted` = 浏览器布局/绘制成本。
- `session.listUnmount`：旧列表卸载成本（实测 30 回合约 20–65ms，通常不是瓶颈）。
- `detail:*` 在网络环节；如果这里就占了几秒，说明慢在会话详情接口而不是渲染。
- `scroll:*` 记录滚动位置恢复与重试；列表挂载后才撑高内容，重试属于预期。

> `totalMs` 是**累计值**（同一指标多次触发会相加）。比较单次切换时先 `__gdPerf.reset()`，
> 或看 `maxMs`；例如一次切换里 `session.listMount` count=2 表示先后挂载了两个会话。

注意：列表与骨架屏在模板里是 `v-if` / `v-else` 互斥，**列表是骨架屏隐藏那一刻才开始挂载的**，
所以「骨架屏消失」的观感天然包含整棵列表的挂载成本。

## 组件挂载热点

会话打开时骨架屏消失才开始挂载列表（见上一节）。如果 `panel:skeleton-hidden → panel:list-patched`
很大，但 `markdown.initial.*`、`fileChanges.compute`、`toolCalls.*` 都只有几十毫秒，说明成本在
Vue 组件/DOM 挂载本身。

**注意：`vue.*` 指标默认关闭。** 开启 `app.config.performance` 后，Vue 会为每个组件生成
mark/measure，实测在 31 回合、约 4000 个组件的列表上会让 `session.listMount` 从 **~0.87s**
涨到 **~2.79s**——测量本身会严重放大被测对象。需要归因时再临时开启：

```js
localStorage.setItem('gd:vue-perf', '1')
// 刷新页面 → 切换会话 → __gdPerf.report()
// 用完恢复：
localStorage.removeItem('gd:vue-perf')
// 刷新页面
```

开启后，Vue 内置的组件阶段 measure 会被采集为 `vue.<Component> init / render / patch / mount`：

- `<X> init`：setup 耗时
- `<X> render`：组件 render 函数耗时
- `<X> patch`：子树 patch（**包含子组件挂载**）
- `<X> mount`：setup + render + patch 的同步总耗时（**包含子组件**）

因此：

- 只用于**相对归因**：找实例数特别多或 `mount` 异常大的组件（`ElIcon`、`Chevron*`、
  `MessageToolCalls`、`MessageThinkingSection` 等）；
- 父组件的 `mount`/`patch` 天然包含子组件，不要跨层级直接相加；
- 这些数字包含 measure 自身开销，不能当作生产环境的绝对耗时；
- 真实基线请关闭该开关后看 `session.listMount`。

## 回合懒挂载（v1）

会话打开时只挂载最后 8 个回合（`ChatPanel.vue` 的 `LAZY_TURNS_INITIAL`），其余回合渲染为
800px 等高占位（占位顶部有两条 shimmer 线条，表示仍在加载）；`IntersectionObserver`（上下各
800px）在接近视口时挂载并**保留**（不卸载）。

挂载时的滚动补偿使用**内容锚点保持器**：记录视口内第一个回合/占位相对滚动容器的屏幕位置，
任何内容高度变化（折叠/展开、图片加载、占位挂载、流式增长）后，在 `nextTick` 把同一锚点钉回
原位置（`scrollTop += 新位置 - 旧位置`）。不要按每个占位的高度差累加——视口下方的占位长高不
影响当前画面，累加会过度补偿，表现为“内容突然被顶出去”。实测一次挂载 4 个占位、内容长高
7440px 时，scrollTop 只补 2678px，锚点位移 0px；手动注入 500px 高度时 scrollTop +500、锚点
位移 0px，移除后 scrollTop -500、锚点仍为 0。

另外：

- `content-resize` 会同时触发几何兜底（补挂新进入视口附近的占位）和锚点校正；后台/遮挡时
  IntersectionObserver 可能被节流，这条路径保证折叠/展开后占位仍能按位置挂载。
- 锚点校正只在**非贴底**时生效；贴底继续交给 ScrollContainer 的尺寸增长贴底。
- 用户滚动会更新锚点；滚动位置与记录不一致时放弃校正，不抢滚动权。
- 到顶时按**小批量（8 个）**挂载上一段，而不是一次性挂 20+ 个；每批同样做锚点补偿。
- `scrollToMessage` 在大纲跳转时先 `await nextTick()` 等全量挂载完成，再查目标元素。
- `TurnItem` 已移除 `content-visibility: auto / contain-intrinsic-size`：懒挂载已降低挂载量，
  而 800px 估算会在回合进入视口时替换成真实高度（中位数 ~1700px），关闭原生滚动锚定后会
  表现为跳变。现在已挂载回合始终按真实高度布局，锚点补偿才准确。

**关闭开关**（A/B 对照）：

```js
localStorage.setItem('gd:lazy-turns', '0')   // 刷新后恢复全量挂载
localStorage.removeItem('gd:lazy-turns')     // 恢复默认懒挂载
```

安全回退（这些场景直接全量挂载，避免内容找不到/位置错乱）：

- 会话有**非贴底**滚动记忆（读到中间/顶部再切回来）；
- 滚到顶触发 `near-top` 时仍有未挂载占位 → 先全量挂载，再拉更早历史；
- 大纲跳转目标回合尚未挂载。

实测（31 回合、866 事件、无 DevTools、Vue measure 关闭）：

| 场景 | 懒挂载前 | 懒挂载 v1 |
|---|---|---|
| 冷刷新打开 `session.listMount` | 1407ms | **359ms** |
| 二次切换 `session.listMount` | 1354–1576ms | **237ms** |
| 初始 DOM 节点 | 21,404 | **4,782** |
| 初始挂载 TurnItem | 30 | **7 (+1 事件卡)** |

v1 已知限制：占位高度是固定 800px 估算（上方挂载时做高度补偿，可能有几十~几百 px 的落点偏差）；
滚到顶会一次性补齐所有已加载回合；读到中间再切回的会话按全量挂载处理；大纲跳转会全量挂载。

## 复现场景

建议每个场景前先 `__gdPerf.reset()`。

### 1. 历史回放

打开一个长会话（建议 100+ 回合），向上滚动触发 3–5 次 load-more，然后 `__gdPerf.report()`。

重点看：

- `replay.foldEvents` 的 `count` 与 `totalMs`：每次翻页都会把整个 eventLog 从零重折，
  `meta.events` 应随页数递增——如果 total 呈明显二次增长，就是回放全量重建的成本。
- `replay.fetch` 与 `replay.foldEvents` 的占比：区分网络还是折叠。
- 长任务与 FPS：判断是否造成主线程卡顿。

### 2. 流式渲染

发送一个带多轮工具调用的消息，等回合结束，然后 report。

重点看：

- `live.chunk.*`：`text_delta` 次数通常最多，单次耗时应很小；`tool_calls_response` 若偏高，
  与 `findBlockByToolCallId` 全树扫描有关。
- `markdown.parse` / `markdown.diff`：与正文长度成正比，每次 delta 全量重解析；
  整条消息累计呈 O(L²) 量级。
- `outline.recompute`：每次 delta 重算全部回合预览，固定成本。
- `turnItem.deepWatch` 计数：与 delta 次数同量级即符合预期。

### 3. 交互与滚动

展开/收起分组、连续滚动、点击「回到底部」，然后 report。

重点看 `scroll.groupBody` / `scroll.bottom` 的 p95 与长任务。两处都会强制布局读
（`scrollHeight`）+ 写（`scrollTop`）。

## 解读顺序

按 `totalMs` 降序看，先区分「固定成本」与「随内容量增长」：

1. `markdown.parse` / `markdown.diff` —— 随正文长度增长，流式期间是主成本。
2. `outline.recompute` —— 与新增内容量不成正比的固定成本（每 delta 全量扫回合）。
3. `turnItem.deepWatch` —— 深遍历固定成本，只能看触发次数与长任务间接判断。
4. `group.build` —— 每 delta 全量重建 DisplayItem/DisplayGroup 对象。
5. `toolCalls.*` —— 参数增量到达时重复 `partialParse`。
6. `replay.foldEvents` —— 仅在打开/翻页时发生，但随已加载事件数线性增长、随页数二次增长。

需要火焰图级别的下钻时，配合 Electron / Chrome DevTools 的 Performance 面板；
dev 下已设置 `app.config.performance = true`，Vue DevTools 的 Performance 时间线可直接
看到组件 render/update。

## 新增一个指标

```ts
import { perfStart } from '@/utils/perf';

const span = perfStart('your.metric');
try {
  // 被测量的同步逻辑
} finally {
  span?.end({ size: data.length });
}
```

- 异步：`const span = perfStart(...)` 后 `await`，在 `finally` 里 `span?.end(...)`。
- 高频路径优先用 `perfStart` + `span?.end({...})`：关闭时可选链短路口径，不会创建 meta 对象。
- 不要记录字符串/对象引用，只记录数字或短的枚举字符串（如 `reason`、`type`）。
- 纯计数用 `perfCount('name')`。
