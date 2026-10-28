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
| `group.build` | `groupContentsForDisplay` 分组构建；meta：`blocks`、`groups` |
| `markdown.parse` / `markdown.diff` / `markdown.initial` | Markdown 解析、diff-dom、首渲染；meta：`chars` / `html` |
| `outline.recompute` | 大纲 `outlineItems` 重算；meta：`turns` |
| `turnItem.deepWatch` | 分组 deep watch 触发次数（纯计数） |
| `scroll.groupBody` / `scroll.bottom` | 两处贴底布局读写耗时 |
| `toolCalls.rowDisplays` / `toolCalls.rendererInfos` | 工具行 computed 重算（含 `partialParse`）；meta：`calls` |

报告还会附带：长任务次数与阻塞总时长（≥50ms）、平均 FPS、JS 堆内存（Chromium）、DOM 节点数。

> FPS 只在窗口可见时采样（浏览器会暂停后台 tab 的 `requestAnimationFrame`）；
> 在后台/隐藏窗口里显示为 0 属于预期，不代表渲染卡顿。

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
