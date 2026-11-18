# 窗口最大化/还原自动测量（2026-11-17）

脚本：`scripts/perf-window-resize.js`。真实开发前端/后端，历史会话 `cmsze0g4b005e3ckzv1jlqidi`，事件页866条，30回合。未发送消息或修改会话内容。

## 测量边界

独立 Electron BrowserWindow 原生 maximize/unmaximize，页面约1264×695→2560×1343→还原。运行真实前端的 Web 模式，没有产品 preload、CustomTitlebar 和完整主进程，也未复刻用户当前主题及工作区。

自动化环境窗口 isVisible=false；关闭后台/遮挡节流并通过 CDP focus/lifecycle emulation 保持产帧，已确认页面实际尺寸变化。可用于主线程布局阻塞对比，不能代表前台呈现帧率、GPU Present 或系统光标延迟。使用开发构建。--no-trace 关闭 Tracing，但 CDP 仍附加。

首次无帧报告13-53-48-227Z无效，不纳入结论；14-02-01-974Z单轮报告的相对时钟有约700ms偏移，时序结论使用之后修正时钟的报告。

## 结果

每条件3轮，一轮包含最大化与还原。帧间隔为rAF回调间隔。

| 条件 | 回合/DOM | 各轮最长帧间隔ms | 每轮长任务累计ms |
|---|---|---|---|
| 懒挂载，不录trace | 9/5583 | 69.4/61.7/56.9 | 120/106/103 |
| 全挂载，不录trace | 30/20692 | 182.2/185.1/201.7 | 343/350/359 |
| 全挂载，提前降级，不录trace | 30/20692 | 170.6/159.4/158.5 | 304/305/294 |
| 全挂载，恢复宽1000，不录trace | 30/20691 | 186.2/187.8/179.2 | 340/346/342 |
| 全挂载，录trace | 30/20692 | 188.5/192.6/188.2 | 361/369/359 |
| 全挂载，提前降级，录trace | 30/20692 | 176.7/173.9/173.4 | 323/313/315 |
| 全挂载，关闭回合cv，录trace | 30/20692 | 197.3/209.5/201.9 | 469/444/412 |

提前降级调用现有beginResizeActivity/markResizeMoved，窗口操作120ms后释放票据，再走原有150ms尾延迟。

## Trace依据

默认全挂载第1轮：t=5ms开始178ms长任务；t=185ms才投递resize；t=192ms挂降级class。还原t=1610ms发起，t=1614ms开始183ms长任务，t=1798ms resize，t=1800ms挂降级。最大Layout=173.222ms，dirtyObjects=totalObjects=14933，partialLayout=false。说明resize→rAF降级晚于首次完整布局。

提前降级后resize约31～42ms投递，但收尾TimerFire出现155～163ms长任务。一个162.912ms TimerFire内部：UpdateLayoutTree=89.751ms、约9359元素；Layout=67.943ms；指向useResizeActivity.ts收尾回调的FunctionCall本体约4.375ms。主开销是恢复时的样式/布局，不是JS本体跑了160ms。

关闭回合cv后最大Layout=189.97ms，且增加51～57ms长任务，直接移除cv无效。不录Tracing仍复现182～202ms长间隔，确认不是录制单独制造的峰值。

1000px恢复测试没有比1280px显著更大主峰，本轮不支持侧栏阈值是主因。

## 建议

优先有界历史渲染和超大回合分块；折叠组延迟挂载；提前降级必须同时处理解除降级的全量恢复峰值。不要只提前开class或延长防抖。后续在真实产品主窗口、生产构建及用户主题复核。

## 修复与验证（2026-11-18）

### 第一步：有界回合窗口

已按结论实施「有界回合窗口」：

- `frontend/src/utils/turnWindow.ts`：卸载决策纯函数（保护区、滞回边界、上限兜底、占位高度回落），13 项单测覆盖；
- `ChatPanel.vue`：卸载前实测回合内容高度写入缓存、占位沿用 `.turn-wrapper` 同款外边距（避免卸载改变列表总高度）、
  滚动停止 300ms 后规划卸载、视口内与尾部回合受保护、调整态与滚动恢复期间跳过卸载；
- 到顶分页改判「视口上方是否还有占位」（否则有界窗口下会一直去补挂下方回合，永远拉不到更早历史）；
- 大纲跳转由「全量挂载」改为按目标开窗（`mountTurnsAround`）；
- 非贴底滚动记忆新增回合锚点（`anchorTurnId`/`anchorOffsetPx`），恢复不再依赖占位高度估算。

验证（同一会话、真实 Electron 窗口、关闭 Tracing）：

| 场景 | 结果 |
|---|---|
| 上限=6，来回浏览 16 步 | 已挂载数 8～10，DOM 由约 10,400 降至约 5,100；视口内始终是真实回合 |
| 上限=6，锚点稳定性 | 16 步全部锚点位移 0px、无锚点丢失 |
| 默认上限，浏览 12 步后做最大化/还原 | 12 回合、最长帧间隔 65～76ms（全量 30 回合基线为 182～202ms） |
| 前端全量单测 | 94 文件 / 1143 项通过；vue-tsc 与 eslint 无报错 |

A/B 开关：`localStorage['gd:turn-window-max']='6'` 覆盖已挂载上限（默认 24）。

诊断脚本：`scripts/perf-turn-window-probe.js`（挂载/卸载采样）、
`scripts/perf-turn-window-anchor.js`（卸载锚点稳定性）、
`scripts/perf-turn-window-visible.js`（视口内是真实回合还是占位）。
三者与主测量脚本一样需真实 Electron 窗口：浏览器后台标签页会暂停 rAF 与 scroll 派发，测不出挂载行为。

### 第二步：折叠组延迟挂载

折叠的工具/思考组原先只是「挂载但不绘制」（`content-visibility: hidden`），组件实例与 DOM 都在。
现改为收起态**不挂载子树**，展开状态外置到模块级 `disclosureState`（带 LRU 2000 + 按回合清理），
保证回合被有界窗口回收、重新挂载后仍保持展开。

改动：`utils/disclosureState.ts`（新）、`groupExpansion.ts` 的 `shouldMountGroupBody`、
`TurnItem.vue`（`v-if` 加在内层内容上，保留 body 外壳以维持 `grid-template-rows` 过渡）、
`MessageToolCalls.vue` / `MessageThinkingSection.vue` 新增可选 `persistKey`。

| 指标（9 回合首屏） | 常驻挂载（旧） | 延迟挂载（新） |
|---|---|---|
| 折叠组内部 DOM 节点 | 2,378 | **0** |
| 页面总 DOM 节点 | 5,582 | **3,204（−43%）** |
| `.process-group__body` 已挂载数 | 62 / 62 | 0 / 62 |

跨卸载状态保持（上限=4 强制回收，真实 Electron 窗口）：

```
展开顶部折叠组 → expanded=1
向下滚动 → 目标回合变 placeholder（真实卸载）
滚回 → 重新挂载，expanded=1 ✅
```

A/B 开关：`localStorage['gd:lazy-groups']='0'` 回到「常驻挂载 + content-visibility」旧行为。

#### 修复记录：分组「能展开但收不起来」

引入状态表时 `toggleGroup` 写入用的是**裸 `group.id`**，而读取走的是**带 turnId 前缀的复合键**。
于是每次点击都读不到已有值、只能按运行态取反：对非最后一组（`isActive=false`）永远算出 `true`，
表现为「点得开、收不回」。改为写入与读取共用同一个 `key` 后修复，
并在 `groupExpansion.test.ts` 增加 3 项回归用例（含「裸 id 读不到复合键」的成因断言）。

真实窗口复核（连点 4 次）：

```
[ true, false, true, false ] ✅ 可展开也可收起
收起后 group 内节点 93 → 11（内容确已卸载）
```

### 重要：这一步没有降低窗口还原峰值的根本原因

全量 30 回合（`--all-turns`）前后对照：

| 指标 | 改造前 | 改造后 |
|---|---|---|
| 静态 DOM 节点 | 20,692 | **10,639（−49%）** |
| 最大化/还原最长帧间隔 | 182～202ms | **164～188ms**（无实质下降） |

trace 给出了原因：176ms 的那次 `Layout` 中，主体是
`InlineNode::ShapeTextIncludingFirstLine` 被调用 **2,080 次**，
`dirtyObjects = totalObjects = 14,964`。

即：这次全量布局的代价集中在**可见正文的文本整形（换行/字形）**，而不是折叠组内部的工具行 DOM。
折叠组延迟挂载确实减掉了约一半 DOM 与全部折叠组的组件实例，
但**它不减少可见正文的行数**——窗口宽度变化时，可视区里的 markdown 正文仍要重新整形。

结论：若要继续压低这一峰值，方向应是「减少一次全量布局中需要整形的文本量」，
例如窗口尺寸变化期间对视口外的正文也启用 `content-visibility`（代价是滚动跳动，需配合高度冻结），
或按展示块拆分超大回合。折叠组延迟挂载本身是**内存与挂载成本**的优化，不是这一峰值的解法。

## 复跑

```bash
node scripts/run-electron.cjs --timeout=90000 scripts/perf-window-resize.js cmsze0g4b005e3ckzv1jlqidi --iterations=3 --no-trace
node scripts/run-electron.cjs --timeout=90000 scripts/perf-window-resize.js cmsze0g4b005e3ckzv1jlqidi --iterations=3 --all-turns
```

选项：--all-turns/--prearm/--no-cv/--no-trace/--width=1000/--sweep。结果写tmp/perf-window-resize-*.json及.trace.json，trace可导入DevTools Performance。

折叠组专项：`node scripts/run-electron.cjs scripts/perf-collapsed-groups.js <sessionId>`，
加 `--off` 做旧行为对照；配 `GUADA_PERF_MAX_MOUNTED=4` 才能强制回收验证跨卸载状态保持。

主要数据：14-18-13-866Z全挂载trace，14-19-48-229Z提前降级trace，14-27-25-611Z首屏非trace，14-27-41-438Z全挂载非trace，14-32-50-404Z提前降级非trace，14-33-08-544Z窄窗非trace。
