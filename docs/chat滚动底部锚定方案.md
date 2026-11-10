# 聊天滚动底部锚定方案

**日期**：2026-10-16
**范围**：`frontend/src/composables/useScrollAnchor.ts`（新增）、`frontend/src/composables/chatSessionScrollMemory.ts`（新增）、`frontend/src/components/ui/ScrollContainer.vue`（重构）、`frontend/src/components/chat/ChatPanel.vue`（改造）

## 一、背景：旧实现的问题

旧实现是「几何判定 + 启发式」：

- `ScrollContainer` 的 `ResizeObserver` 只要 `autoScroll` 为真就无条件贴底（只跳过宽度变化）；
- `ChatPanel` 在 scroll 事件里用 `lastScrollTop - scrollTop > 10` 反推「用户主动上滚」，据此开关 `needScrollToBottom`；
- 展开思考框/工具分组时靠 `provide('lockScrollAnchor')` 全局锁住自动贴底，等用户下次贴底自动恢复。

问题在于**识别机制本身有竞态**：`needScrollToBottom` 只能在 scroll 事件回调里翻转（旧代码还包在 rAF 里），而 scroll 事件在滚动发生后的下一渲染帧才派发。用户上滚与流式内容增高落在同一帧时，"delta > 10px" 会被内容增高掩盖，随后的 `ResizeObserver` 贴底就把人拽回底部——这正是用户反复报障的"往上翻又被弹回去"。

根子不在阈值调得准不准，而在**判定维度选错了**：用"滚动位置怎么变了"去反推"用户想干什么"，而位置变化同时被用户输入、内容增长、布局重排三种原因驱动，事后无法区分。

## 二、设计模型：`following` 是用户滚动权，不是几何快照

新实现的核心是把"谁有权改变贴底状态"显式建模：

- `following === true`：用户位于底部，新内容（流式增量、尺寸增长、新回合）自动贴底；
- `following === false`：用户上滚离底，流式内容**不得**拉回阅读位置，「回到底部」按钮出现；
- 用户手动滚回底部（或点按钮）→ 恢复跟随。

关键规则：**只有真实用户输入可以改变 `following`**。程序化贴底、布局重排、加载更多的高度补偿产生的 scroll 事件一律不许改。这条约束是本模块存在的唯一理由。

落地成四件事：

**1. 在 scroll 事件之前捕获用户意图。** 用 capture 阶段监听 wheel / touch / 键盘 / 滚动条 pointerdown。因为 scroll 事件在滚动发生后的下一渲染帧才派发，用户上滚与同帧的内容增高 commit 会撞车——必须在 capture 阶段**同步**把 `following` 置 false，否则那个 commit 会拿着过期的 `following=true` 把人拽回底部，而回弹落点又让随后的 scroll 事件把跟随判回 true，用户的上滚被整体吞掉。

**2. scroll 事件按来源分类。** 本列表未虚拟化，只需两类：有活跃用户意图的算 `user`，其余算 `layout`。`user` 按落点重算跟随态（落底 ⇔ 跟随），`layout` 保持既有意图不变。

**3. 贴底前先对账。** `reconcileFollowingForContentAnchor` 处理"上滚已发生但 scroll 事件尚未派发"的窗口：明确向上 → 立即解除；无用户输入 → 原样保持；方向未知/向下 → 落底则恢复跟随、明显回退则解除。

**4. 贴底动作即时完成。** 写 `scrollTop = scrollHeight` 后**回读入账**（浏览器会钳到最大可滚动距离），不使用 smooth——平滑的中间帧落点会被误读成"离底"。

## 三、为什么不用 column-reverse

`column-reverse` 能让"贴底"变成免费（滚动原点落在底部），但它与本项目主消息列表的既有坐标系冲突。项目里所有与位置相关的机制都建立在"scrollTop 向下增大、DOM 顺序 == 视觉自上而下"上：

- 分页加载更多是**往顶部前插**，靠 `scrollTop = heightDiff` 补偿高度差（`ChatPanel`）；
- `scrollToMessage` 用 `offsetTop` 定位，参考点是容器顶部；
- `ChatOutline` 的激活判定取「与可视区相交、时间顺序最早的那条」，依赖 `querySelectorAll('[data-message-id]')` 的 DOM 顺序；
- `TurnItem` 的 `last:min-h-[60vh]` 是"对话末尾呼吸位"，语义是最后一个 DOM 子节点在视觉底部；
- `content-visibility: auto` + `contain-intrinsic-size: auto 800px` 的屏外估算语义。

走 column-reverse 意味着这些全部要改成逆运算（前插变追加、`offsetTop` 变底部参考、DOM 顺序与视觉顺序相反、呼吸位反转）。

**结论**：`column-reverse` 适合小型内层滚动盒——本项目 `MessageThinkingSection.vue` 的思考框已在用，场景正好吻合（无分页、无跳转、无记忆、内容只在底部长）。但主消息列表选显式状态机：保持既有坐标系与全部功能不变，额外成本只是一个纯函数模块。

## 四、本实现的取舍

- **只分 `user` / `layout` 两类来源**：没有虚拟化，就不存在"第三方程序化滚动"需要单独归类。前插平移、会话恢复、跳转校正都是本模块自己写入并立刻回读入账。
- **`markLayoutScroll` 保护窗实际参与裁决**：本模块写入 scrollTop 后浏览器派发的那一次 scroll 事件，落点往往低于账目值，若不豁免会被误判成"未观察上滚"而解除跟随。做法是在该轮对账里把账目基线置 `null`（跳过未观察上滚检测），语义见 `reconcileFollowingForContentAnchor` 的 `lastObservedScrollTop` 参数。
- **视口缩小 clamp 不算上滚**：容器变小会把 scrollTop 向下钳制，那不是用户意图。新增 `viewportShrank` 参数，比较上一次账目的 `clientHeight` 判定，只豁免该轮。
- **到顶补页只在用户滚到位时触发**：恢复位置、贴底 clamp、前插补偿这些程序化滚动不冒充"用户拉取历史"（`onNearTop` 只在 `source === 'user'` 分支调用）。
- **跟随态每帧贴底，宽度变化不例外**：拖拽分割条/窗口缩放会逐帧改变宽度并引发文本重排，内容随之变高。ResizeObserver 回调在布局之后、绘制之前投递，回调里读 `scrollHeight` 不会插入强制布局、写 `scrollTop` 也不使布局失效，因此跟随态可以直接当帧贴底，不需要「暂停—稳定后补一次」的窗口（该窗口会让滚动条先脱离底部、再突然跳回，见 §十二）。宽度变化的唯一特殊之处是：离底阅读时，它引起的高度变化不参与「收缩钳到贴底 → 恢复跟随」对账。
- **会话滚动记忆按 sessionId 隔离**（不叠加工作区路径）：保存发生在切换瞬间，此刻能读到的会话对象可能已是"切过去"的那个，叠加工作区会让同一会话算出两个键、记忆静默失效。
- **恢复需要重试**：屏外回合带 `content-visibility`，首帧按 `contain-intrinsic-size: auto 800px` 估算，记忆位置可能超出当时的可滚动范围（被钳到上限）。`shouldRetryScrollMemoryRestore` + `content-resize` 回调在内容撑高后补落，直到到位或用户滚动（意图优先）即放弃。
- **发消息/重答显式取回跟随**：这两个入口是"我要看新回合"的明确意图，即便此前在上滚状态也置 `following=true`，否则新回复流式增长时内容继续在视野外长高。

## 五、退役项

- `needScrollToBottom` / `lastScrollTop` / `scrollTicking` / `updateScrollButtonVisibility` / `SCROLL_TOP_THRESHOLD` 全部删除。
- `provide('lockScrollAnchor')` 撤掉：`TurnItem.vue` 与 `MessageThinkingSection.vue` 里的 `inject` 带 no-op 默认值，自动降级——展开分组是布局变化，按状态机语义本就动不了 `following`，不再需要"锁"这个例外。（2026-11 补充：两处 no-op inject 已随 TurnItem 内层失效的贴底 watcher 一并删除，贴底职责完全归本模块。）
- 回到底部按钮显隐改为**跟随态事件驱动**（`following-change`），删掉 100ms 防抖与 rAF 规避逻辑（按钮是绝对定位浮层，显隐不改变 scrollHeight）。
- `ScrollContainer` 内容包装 div 加 `overflow-anchor: none`，覆盖全部四个消费方（其余三处内容静态，无锚定收益可失）。原因是内容子树里放着一个 sticky 底部的写作区，它会被 Chrome 的原生滚动锚定选作锚点候选，并在高度变化后覆盖我们 layout 阶段的贴底/恢复值。

## 六、验证

- `frontend/src/composables/useScrollAnchor.test.ts`：30 条纯函数单测（epsilon 边界 47/48/49、两种来源裁决、对账分支、viewportShrank 豁免、意图解码器、到顶阈值）。
- `frontend/src/composables/chatSessionScrollMemory.test.ts`：16 条（键隔离、LRU 淘汰与触碰、clamp、重试判定）。
- 全量 `vitest run` 504 通过；`vue-tsc --noEmit` 与 `eslint` 干净；`vite build` 成功。

## 七、已知残余

1. **跳转到最后一类目标时按钮短暂常显**：跳转登记用户意图后，平滑动画的中间帧落点都离底，`following` 按落点判为 false，「回到底部」按钮在动画期间显示；落点是最后一条时动画结束才消失。属预期内的可接受表现（跳到历史中间时按钮保持显示本就是正确的）。
2. **同一会话同屏双实例共享记忆**：主区与浮窗共用一条 sessionId 记忆，互相覆盖。会话 ID 唯一 + 同一时刻通常只有一处可见，暂按轻微代价接受。
3. **`loadMore` 期间用户滚动**：补偿写入与用户滚动同帧时，补偿落点可能略偏离记忆位置；保护窗与意图优先保证 `following` 不会被误改，位置偏差由下一次 `content-resize` 重试纠正（仅非贴底记忆）。
4. **`content-visibility` 高度估算**：`auto 800px` 是首次渲染前的占位估算（实测回合高度中位数约 1700），恢复重试是这一取舍的补偿手段；若将来估算偏差导致明显跳变，考虑把已渲染回合的真实高度写入记忆。

## 八、修复记录：切换会话回来停在顶部

**现象**：会话 A 上滚到中间 → 切到 B → 切回 A，位置落在顶部（而非恢复原阅读位置）。

**排查方式**：临时在 `capture` / `apply-session` / `applyPending` / `ResizeObserver` 四处打 `[scroll-restore]` 前缀日志，按日志链条定位。日志证明：

- `capture {pinned:false, top:21335}` —— 离开 A 时保存成功；
- `apply-session {found:true}` —— 切回 A 时读回成功；
- 但**其后没有任何 `apply` 行** —— 恢复写入根本没执行。

**根因**：`handleFollowingChange` 里有一行"失去跟随权就放弃待恢复"（`if (!following && pendingScrollRestore) pendingScrollRestore = null`），本意是"用户中途滚动就别跟用户抢位置"。而 `applyScrollRestoreForSession` 的顺序是「先登记 `pendingScrollRestore` → 再 `setFollowing(false)`」，`setFollowing` 会**同步** emit `following-change` → `handleFollowingChange(false)` → 立刻把刚登记好的待恢复清成 null → 随后的 `applyPendingScrollRestore()` 空转。内容替换后 `scrollTop` 停在 0，且因 `following=false` 还显示了「回到底部」按钮。

**修法**（两处，双保险）：

1. 把待恢复登记挪到 `setFollowing` / `handleFollowingChange` **之后**；
2. 新增 `applyingScrollRestore` 标记，让 `handleFollowingChange` 能区分"恢复自己的程序化 `setFollowing`"与"用户真实滚动"，不再依赖语句顺序。

**教训**：`following-change` 是同步 emit 的，任何在 `setFollowing` 前后写共享状态的代码都必须明确"这次变更是谁引起的"。靠语句顺序规避是脆的——加一个显式标记，顺序变了也不会静默失效。同类 TDZ 教训：`watch` 注册时会立即求值一次 getter，被 watch 的变量必须已定义（可用 `no-use-before-define` 自动发现），这一点类型检查与单测都抓不到。

## 九、修复记录：大纲远距离跳转被贴底撤销

**现象**：侧边栏大纲点远处的消息，跳不过去——刚滚上去又被立刻拉回底部。近处的消息正常。

**根因**：`scrollToMessage` 只调了 `markLayoutScroll()`（声明为程序化滚动），**没有登记用户意图**。而状态机的规则是"只有用户输入能改变 `following`"，程序化滚动一律保持原状——于是用户本来贴在底部时 `following` 仍为 `true`，跳转途中 `content-visibility` 的屏外回合按真实高度展开撑高内容，`handleContentResize` 走到 `following && 宽度未变 → 贴底` 这一步，把跳转整个撤销。

近处能跳是因为目标本来就在视口附近、行早已按真实高度渲染过，跳转不引发高度变化，贴底路径没有触发——**不是跳转正确，只是没踩到撤销条件**。

**为什么原设计漏了**：`markLayoutScroll` 的语义是"这次写入是程序化的，别让几何账目误判成用户上滚"，它保证的是"不误判"，而这里需要的是"明确表态用户要离开底部"。前者是防守、后者是进攻，两者不可互替。凡是从滚动容器**外部**发起的导航（大纲、引用跳转、搜索结果定位），都必须显式登记用户意图。

**修法**：
1. `scrollToMessage` 开头与每轮校正前 `markUserIntent('awayFromBottom')`——点击大纲是明确的"离开底部去读历史"。意图生效后，跳转途中的 scroll 事件按 `user` 分类、由落点裁决 `following`，贴底路径自然让位。落点若恰在底部（点最后一条），落点裁决会自动把 `following` 判回 true，无需特判。
2. 落点校正从单轮改为**有界多轮**（`SCROLL_TO_MESSAGE_MAX_CORRECTIONS = 4`）：屏外回合的真实高度要等进入视口才展开，且每新展开一行都会再把目标推走一次，单轮校正不足以收敛——这是"远距离跳转落点不准"的独立成因。

**教训**：滚动权状态机的"程序化 vs 用户"二分，天然漏掉"由组件外部触发、但语义上是用户意图"的操作。这类入口必须逐个显式登记意图，不能指望几何启发式替它表态——旧实现恰好是靠几何（scrollTop 回退 > 10px）蒙对的，换成状态机后反而暴露了这个隐含依赖。

## 十、修复记录：流式中点「回到底部」落不到真正底部

**现象**：输入区上方的「回到底部」悬浮胶囊，在流式输出期间点击有一定概率只回到半路；极端情况下（已在底部附近）点击完全没反应。

**两种失败模式**：

1. **平滑动画追不上移动的底部**。`scrollToBottomSmooth()` 在点击瞬间读一次 `scrollHeight` 作为固定目标，`scrollTo({top, behavior:'smooth'})` 之后内容仍在增长，落点是过期的。点击当时只登记了 `towardBottom` 意图、没有置 `following=true`；而该意图让动画中间帧被归为 `user` 来源，`resolveFollowingAfterScroll` 按中间落点把 `following` 重算为 `false`。`handleContentResize` 只在 `following=true` 时贴底，于是流式增长不再补——最终落点距新底部超过 48px 就永久停在半路，按钮也不消失。是否超过取决于动画那几百毫秒里内容长了多少，所以表现为"有一定概率"。
2. **近底点击完全无效**。`scrollToBottomSmooth()` 在距底 ≤48px 时幂等早退，不发任何滚动事件；若此时 `following` 恰好是 `false`（例如会话恢复落在近底位置），就没有任何事件把它判回 `true`，按钮点不掉。

**根因**：把"点击回到底部"当成"跑一次滚动"，指望几何落点事后把跟随态判回来。而跟随态是用户意图，应当由点击直接表达。

**修法**（`ChatPanel.scrollToBottom`）：

1. 先 `setFollowing(true)`——这是"后续内容继续增长也要贴底"的唯一开关，也是按钮能真正落底的保证。
2. `clearUserScrollIntent()` 清掉残留意图：用户刚上滚过时 `awayFromBottom` 仍在 1.2s 有效期内，会把按钮驱动的滚动重新判成用户上滚。
3. 按 `isStreaming` 选方式：流式中用即时跳转（底部是移动目标，平滑动画的固定终点天然追不上）；非流式保留平滑动画。
4. 删掉 `markUserIntent('towardBottom')`：按钮驱动的滚动应视为布局滚动，不能让动画中间帧按落点改写跟随态。
5. 顺带清掉 `pendingScrollRestore`，避免会话位置恢复与用户接管抢位置。

**取舍**：按钮点击即隐藏（跟随态立即置真），不实现"落底后再隐藏"。另外长会话里 `content-visibility` 的屏外回合会在动画途中展开、触发尺寸变化，跟随态为真时贴底路径会直接把视图落到底——表现为"平滑变即时"，结果正确、观感略生硬。若后续要求严格保留动画，需要再加"平滑滚动期间抑制贴底 + 落底校正"的窗口机制。

## 十一、修复记录：折叠工具组后「回到底部」按钮不消失

**日期**：2026-11-10

**现象**：工具组展开很长 → 上滚离底，出现「回到底部」按钮 → 折叠该工具组，内容骤短、视图自然回到（或接近）底部，但按钮仍然显示，需要再手动点一次按钮或手动滚一下才消失。

**根因**：状态机的规则是"只有真实用户输入能改变 `following`"，而折叠工具组是点击折叠按钮，不产生任何经过滚动容器的 wheel/touch/key 意图。内容收缩后浏览器把 `scrollTop` 向底部钳制，由此派发的 scroll 事件按"无意图 → layout 来源"分类，`resolveFollowingAfterScroll` 对 layout 来源原样保持 `following=false`；`reconcileFollowingForContentAnchor` 的 `userScrollIntent === 'none'` 分支也直接返回原状态；ResizeObserver 的 `handleContentResize` 只在 `following=true` 时贴底。三条路都不动 `following`——"离底阅读"这个前提已经被收缩摧毁了，状态机却没有任何机制知道这一点。

这是"只有用户输入能改变 following"规则的**漏例**：内容**收缩**可以在零用户输入的情况下把用户推到几何底部。增长没有这个问题（流式增高时落点仍离底，保持阅读位置是正确的），所以对账必须区分收缩与增长，不能按落点无差别判回。

**修法**（`useScrollAnchor.ts`）：

1. 新增纯函数 `resolveFollowingAfterContentShrink`：仅当内容高度下降（`heightDelta < 0`）且钳制落点在 `BOTTOM_ANCHOR_EPSILON_PX` 内时恢复跟随，其余情况原样保持。
2. `handleContentResize` 加收缩对账分支：新增 `lastContentHeight` 账目变量（模式同 `lastContentWidth`，`attach` 时置 0），宽度未变、已解除跟随且高度下降时读一次 metrics 对账。折叠是 0fr→1fr 动画，多帧 ResizeObserver 逐帧触发，收缩到某一帧落点进 48px 内即恢复跟随，后续帧走既有 `following=true → 贴底` 分支，动画全程视图自然贴底。
3. 对账恢复后的次序是安全的：`commitFollowing` 同步 emit `following-change`，ChatPanel 的 `handleFollowingChange` 先更新 `isFollowingScroll`，随后的 `content-resize` 里锚点钉回（`scheduleAnchorRestore`）因 `isFollowingScroll=true` 自动跳过，不与贴底抢位置。

**已知未修的同构场景**：拖大聊天视口使全部内容可见时，同样会被钳到贴底而按钮残留——触发频率低（需要拖视口而非折叠内容），暂不处理；若要修，同一对账函数可直接复用（视口增大的对账条件是 `viewportHeight` 上升而非内容高度下降）。

**教训**：不变量"following 只由用户输入改变"的正确性依赖一个隐含前提——"离底"必然来自用户输入。内容收缩破坏了这个前提：几何落点可以在无输入的情况下变得与 `following=false` 矛盾。凡是维护"用户位置"类状态的地方，都要问一句：除了用户输入，还有什么操作会改变这个状态的前提？

## 十二、修复记录：挤压聊天区时滚动条脱离底部再跳回

**日期**：2026-11-10

**现象**：长会话置底时拖分割条把聊天区压窄，内容随文字重排自然变长，滚动条先脱离底部；拖拽中途一停顿，滚动条又突然跳回底部；继续拖会反复上下跳。把聊天区拖得比 `max-width: 744px` 宽时不复现（此时改宽度不改变排版，`scrollHeight` 不变）。

**根因是两个互不知情的计时器**：

1. `handleContentResize` 把宽度变化当成需要 120ms 稳定的重排：`contentWidthChanging = true`，窗内**完全停止贴底**。连续拖拽时每次宽度变化都重置定时器；一旦停顿超过 120ms，定时器执行 `scrollTop = scrollHeight` 的瞬时跳回。继续拖 → 再次脱离 → 再次跳回。
2. 松手后 `useResizeActivity` 还有 150ms 尾延迟：到期时先摘 `gd-resizing-moved`、再 `releaseTurnHeights()`。冻结值是**拖拽起点（较宽）时**的一次性快照（`markResizeMoved` 幂等，整个手势只冻结一次），拖窄后离屏回合的真实高度已经变大，解冻让 `scrollHeight` 再阶跃一次 → 若 `following` 仍为真，再贴一次底。120ms 与 150ms 两个计时器叠加，用户看到两次硬跳。

不是锚点保持器：`scheduleAnchorRestore()` 在 `following=true` 时直接早退，拖拽中 `following` 从未改变；真正把人拉回底部的是宽度稳定窗里的 `scrollToBottomImmediate()`。

**对标 deepseek-harness**：它在 pinned 态不做宽度特判——ResizeObserver 观察内容列，每次尺寸变化（含宽度重排）都同步 `scrollTop = scrollHeight` 并记账；用 `observedTopRef` 账目过滤 scroll 事件，落点与账目一致就不改跟随权。离底阅读它没有自研宽度锚定，依赖原生 `overflow-anchor`，其 `ui-layout/README.md` 明确承认「No scroll anchoring during squeeze reflow」。本项目因 sticky 输入区必须 `overflow-anchor: none`，所以离底仍由 `ChatPanel` 的内容锚点保持器负责，只借鉴 pinned 这一半。

**修法**：

1. `handleContentResize` 中 `following=true` 时无条件 `scrollToBottomImmediate()`，删除 `contentWidthChanging` / `widthSettleTimer` / `CONTENT_WIDTH_RESIZE_SETTLE_MS`。ResizeObserver 回调在布局后、绘制前，写入当帧生效，不存在「先画出脱离底部的一帧」。
2. 宽度变化只保留一个特殊语义：离底时它引起的高度变化不参与 `resolveFollowingAfterContentShrink` 对账（避免「拖宽 → 钳到底 → 按钮消失」）。
3. `ChatPanel.handleScroll` 在调整态期间跳过 `scheduleMountVisiblePlaceholders()` 与 `scheduleAnchorRefresh()`：每帧贴底会逐帧派发 scroll 事件，前者是非重置的 80ms 一次性定时器，会在拖拽中途扫描全部占位并挂载（800px 估算换成真实高度，再制造一次高度突变）；后者每 16ms 读一次 `[data-turn-id]` 布局。拖拽收尾的 `content-resize`（冻结高度释放）发生在调整态退出之后，现有门禁会正常补一次。
4. 删除无生产调用的纯函数 `anchorActionAfterContentChange`（仅测试引用）。

**验证**：`useScrollAnchor.test.ts` 新增 6 条运行时用例（假滚动元素 + 假 ResizeObserverEntry）：挤压当帧贴底、连续 5 帧保持贴底、无延迟写入、离底挤压不拉回、宽度不变收缩恢复跟随、宽度变化收缩不对账。全量 `vitest run` 通过。

**已知残余**：

- 拖拽期间离屏回合的冻结高度来自拖拽前的宽度，`scrollHeight` 会低估；滚动条滑块在拖拽中略长、松手后恢复。不影响视口底部位置，也不产生跳动。
- 「拖大聊天视口使全部内容可见时按钮残留」仍是 §十一 记录的另一场景（与视口高度有关，不是宽度重排），本次不改。
