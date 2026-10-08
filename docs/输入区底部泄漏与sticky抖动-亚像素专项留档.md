# 输入区底部泄漏与 sticky 抖动——亚像素专项留档

> 状态：**现象 1 已从根因消除（设备像素吸附）**，中间版本的"覆盖条"已删除。
> 现象 1 的真因：面板底边（= 消息滚动口底边 = 输入区 sticky 底边）落在设备像素之间时，
> 同一条设备像素行上**裁剪向外取整（ceil）、实心填充向内取整（floor）**，两者差 1 个设备像素
> → 滚动消息的行底漏在输入区底边那半行里（字形只剩竖干 → 看着像一条虚线）。
> 修法（当前实现）：**让这条边界落在设备像素整数坐标上**——卡片边框改 `::after` 环（不占布局）、
> 底边距按 `round(up, 4px, var(--gd-device-px))` 吸附到设备网格 → 不存在"半行"，
> 任意缩放、任意滚动相位都不可能漏。
> 关联提交：`8dba24ca` → `4d2b2940` → `3f0fd1c2` → `2db42651`（观察期）→ **设备像素吸附（当前）**。

## 一、现象（三个，常被混为一谈）

| # | 现象 | 出现条件 |
|---|---|---|
| 1 | 输入区底部漏出滚动消息：底边一条**虚线**（文字只剩竖干），发虚 | 面板底边落在**设备像素之间**（整数 CSS 偏移 × 非整数缩放）× 内容相位合适；100%/200% 这类底边本就在网格上的档不出现 |
| 2 | 滚动时输入区跟随滚动抖动：滚动中输入区 top 在 ±8px 摆动（实测 931↔939 @1080 视口），停止后回正 | 遮罩以负 `bottom` 画出 sticky 盒外时必现 |
| 3 | 渐变遮罩渐隐带（20px）半透明，内容从带里透出 | 渐隐带覆盖的几何区间与内容行对齐时，易与 #1 混淆 |

## 二、机制（实测数据）

### 1) 泄漏行 = 面板自身最后那半行（现象 1 的真因）

**"半行"从哪来。** 窗口 CSS 高 = 物理像素 ÷ devicePixelRatio，非整数缩放下是小数
（125% 下 1039 物理像素 → 831.2px）；视口底边却是设备整数。于是从视口底边往里的
**每个整数 CSS 偏移 n 都变成 n × dpr 个设备像素**，只有 `n × dpr` 是整数才落在设备网格上。

实测本项目这条链（dpr=1、视口 831；链的其余部分全是 100%/flex，无额外偏移）：

```
面板底边距视口底边 = 5px = 卡片 4px 外边距(--gd-layout-card-gap) + 1px 边框(border-bottom)
```

小数部分 = `frac(5 × dpr)`：

| 缩放 | 偏移 5px（旧） | 偏移 4px（边框移出布局后） |
|---|---|---|
| 100% | 5 → 整数 ✓ | 4 ✓ |
| 125% | 6.25 → 0.25 ✗ | 5 ✓ |
| 150% | 7.5 → 0.5 ✗ | 6 ✓ |
| 175% | 8.75 → 0.75 ✗ | 7 ✓ |
| 200% | 10 ✓ | 8 ✓ |
| 250% | 12.5 ✗ | 10 ✓ |

**为什么落在小数上就漏。** 同一条设备像素行（如 row 710 = [710, 711]，面板底边 710.5）上：

- **裁剪（overflow）向外取整**：`ceil(710.5) = 711` → 滚动内容**画得进**这半行；
- **实心填充（background）向内取整**：`floor(710.5) = 710` → 遮罩**盖不到**这半行。

于是漏出的正是"消息行底最后 0.5 设备像素"（字形的竖干 → 虚线）；它同时压在卡片底边框的
上半行上，所以看起来"比 `bottom: 0` 还靠下"。**旧版 3px / `bottom: 0` 覆盖条无效的原因**：
它的填充底边落在分数坐标上被 floor，恰好差这一行。

**"有些分辨率没有" = 边界是否落在网格上。** 底边在设备整数坐标上 ⇒ 不存在半行 ⇒
内容被裁在整数边界、遮罩也盖到整数边界，**任意相位都不可能漏**（实测：整数几何下
新/旧/无覆盖条三态逐行亮度完全一致、零泄漏）。底边在小数坐标上 ⇒ 存在半行，
漏不漏取决于内容相位（实测 0.5 时同一相位带 27 个滚动位置里 13 个可见，最多 304 文字像素）。

### 2) sticky 抖动（现象 2）

- 遮罩以负 `bottom` 画出 sticky 盒外 → **sticky 退回主线程更新**：合成器先滚动、主线程后应用
  sticky 偏移 → 输入区跟随内容 8px 再追上。
- 变量隔离实测（1080 视口、滚轮滚动 + rAF 采样输入区 top）：
  遮罩 `bottom: 0 / 76px` → **spread 0**（恒 939）；`bottom: -8px / 84px` → **spread 8**（931↔939）。
- 结论：**sticky 盒内的 `.chat-bottom-fade` 永远不加负偏移**；也不要在盒内做"越过边界"的填充。

### 3) 渐隐带透出（现象 3）

底部遮罩现为实色（`background: var(--gd-color-bg)`，无渐隐带），该现象暂不存在。

## 三、当前实现（设备像素吸附）

三处配合，**零遮挡、零每帧 JS**：

1. **卡片边框改 `::after` 环**（`style.css` 的 `.content-card::after`，`inset: 0` + `border`
   + `border-radius: inherit` + `pointer-events: none` + `z-index: 40`）：
   `border` 占布局，1px 在 125% 下是 1.25 个设备像素，会把卡片**内边**推到设备像素之间；
   环不占布局 ⇒ 卡片内边 = 卡片外沿 ⇒ 偏移只剩 4px 外边距。
   环必须画在内容之上（高于输入区 z-30 / 概览 z-20），否则输入区底部的实色遮罩会把中段
   边框盖掉、线看起来是断的；`pointer-events:none` 保证不挡点击。
2. **`--gd-device-px` = 1/dpr**（`utils/devicePixelGrid.ts`，`main.js` 挂载前写一次；
   跨显示器/改系统缩放由 `matchMedia('(resolution: Ndppx)')` 重算）。
3. **底边距吸附**：`--card-bottom-gap: round(up, var(--gd-layout-card-gap), var(--gd-device-px))`
   （`@supports (width: round(up, 1px, 1px))` 包一层；不支持的引擎退回设计值 4px）。
   把"卡片底边 → 视口底边"抬到设备像素整数倍 ⇒ 面板底边落在网格上。
   支持 `round()` 时**任意缩放**都成立（含 110% 这类无整数倍关系的页缩放）；不支持时
   100/125/150/175/200/250%（Windows 标准档，都是 25% 的整数倍）仍然落在网格上。

视觉等价性（实测，dpr=1、底边区域逐行平均亮度 A/B）：

| 行 | `::after` 环（当前） | 原 `border`（对照） |
|---|---|---|
| 713 | 253 | 253 |
| 714 | 250 | 250.9 |
| **715（边框线）** | **237**（500px 内无跳变 = 不断线） | **236** |
| 716 | 243 | 241 |
| 717–719（卡片外缝隙） | 244/244/245 | 244/244/245 |

几何：环版本 `panelBottom = cardBottom = 716`（距视口底 4px）；border 版本 `panelBottom = 715`
（距视口底 5px）。吸附机制自检（改 `--gd-device-px` 看底边距）：`0.9px → 4.5px`、
`0.6px → 4.2px`、`0.8px → 4px`、`1px → 4px`。

## 四、方案迭代史

| 提交/版本 | 方案 | 结果 |
|---|---|---|
| `8dba24ca` | 遮罩下探 2px（bottom -2px / height 78px） | 部分分辨率仍漏 |
| `4d2b2940` | 下探 8px（bottom -8px / height 84px） | 泄漏被盖，**但引入现象 2**（滚动抖动 8px） |
| `3f0fd1c2` | 遮罩还原 0/76 + 滚动容器外覆盖条（3px，`bottom: 0`） | 现象 2 归零（spread 0）；覆盖条像素级生效，**但用户环境判定无效**（floor 差一行） |
| `2db42651` | 底部遮罩改**实色** + 覆盖条停用 | 观察期；复现证明**仍在漏**（偶发相位） |
| 覆盖条下探 | 覆盖条 `bottom: -2px; height: 5px`（越过分数边界，靠面板 overflow 裁回） | 实测泄漏行 304 文字像素 → 0、27 个滚动位置 × 3 行全 0、`zoom 1.25` 场景 11 个位置全 0；**属遮盖，已删除** |
| **设备像素吸附（当前）** | 边框移出布局 + 底边距按 `1/dpr` 吸附 | 从根因消除：边界落在设备整数上 ⇒ 不存在半行；整数分辨率逐行亮度与旧版一致（见第三节 A/B） |

## 五、关键教训

1. **"半行"是根因，不是"缝"**：只要边界落在设备像素之间，裁剪（ceil）与填充（floor）就
   差 1 个设备像素。想让内容不漏，要么**让边界落回网格**（当前方案），要么**让填充越过边界**
   （覆盖条下探，遮盖）。把填充"停在边界上"（`bottom: 0`）必然差一行——改颜色/渐变/层级都无效。
2. **整数 CSS 偏移 ≠ 设备网格**：非整数缩放下只有 `n × dpr` 为整数的偏移才落在网格上。
   25% 整数倍的缩放档（100/125/150/175/200%）里，**4 的倍数 CSS px 一定安全**；
   1px、2px、3px 都不安全。所以"给卡片加 1px padding / 再包一层 div"这类做法**改不掉**泄漏
   （只是把边界平移到另一条半行上），要加就得加成 4 的倍数（如 3px 而不是 1px）。
3. **不要用负偏移让 sticky 自身或其内部元素画出 sticky 盒外**：会破坏合成器驱动的 sticky
   （现象 2）。要"越过边界"就把活交给不在 sticky 子树里的元素。
4. **布局偏移可以由 JS 写一次变量，但不要每帧 JS 测量**：`--gd-device-px` 只在 dpr 变化时更新，
   属于"一次性环境变量"，与历史删掉的每帧吸附（发虚/抖动）不是一回事。
5. **"泄漏"与"卡片底边框"要分开看**：浅灰细线是 `.content-card` 自己的 1px 边框
   （`--gd-layout-card-border`），**本来就该显示**；泄漏的文字压在这条边框的上半行上，
   视觉上像边框断成虚线。

## 六、参考实现对照

### ZCode（zai-org/ZCode，已克隆 `../zcode`）

- 聊天滚动容器（`packages/ui/src/v4/ConversationTimeline.tsx`）**无** `will-change` / `translateZ` / `contain`；
- **没有**包住聊天区的带边框内容卡（`SessionPane.tsx` 里只有小元素用 border）；
- 策略：整数设计值 + 浏览器默认渲染，不做任何像素对齐 → 该类瑕疵在它那里不存在。

### Qoder CN（`D:\Program Files (x86)\Qoder CN`，app.asar，未混淆保护可直接读）

- 主 UI 在 `out/renderer/`（React），样式集中在 `out/renderer/assets/index-*.css`（467KB）；
- **边缘渐隐用 `mask-image` 实现**（不用覆盖层）：
  ```css
  .scroll-fade-b {
    --q099001: 1;
    --q864a6a: linear-gradient(to top, transparent, black calc(var(--q7d1dca) * var(--q099001)));
    /* mask-image: var(--q864a6a)  */
  }
  ```
- **不需要移植**：mask 在分数边界上同样只有部分 alpha（半行会变半透明而非被盖住），
  而当前方案已把边界落回网格。

## 七、排查工具与复现配方

- **运行时审计**：dev 控制台 `__subpixelAudit()`（`src/utils/devSubpixelAudit.ts`，dev-only）；
  注意它扫 rect，**看不到边框宽度的小数**，后者用静态检查。
- **静态检查**：`npm run check:subpixel`（`scripts/check-subpixel.mjs`）。

### 判断"底边在不在设备网格上"（最快的判据）

```js
const p = document.querySelector('.flex-1.overflow-hidden.w-full.relative').getBoundingClientRect();
const offDev = (innerHeight - p.bottom) * devicePixelRatio;   // 应为整数（容忍 1e-6 级浮点残差）
```

### 复现"分数几何"（不要用 root zoom）

- ✅ **把根高设成小数**：`document.documentElement.style.height = '715.5px'` → 面板底边 = 710.5，
  等价于 dpr=1.25 下的分数底边，且不影响绝对定位。
- ✅ **改卡片底部偏移**（更贴近真实链）：临时给 `.content-card` 加
  `border-bottom-width: 1.25px`，等价于 125% 缩放下 1px 边框占 1.25 个设备像素。
- ❌ 不要把 `document.documentElement.style.zoom = '1.25'` 当 dpr 模拟：页缩放下
  `position: absolute` 元素会整体移位（实测覆盖条被挪到面板下方、被 `overflow` 裁掉 → 误判"覆盖条无效"）。

### 检测泄漏像素（可见化 + 读像素）

```js
// 1) 把滚动区所有文字染红：泄漏的文字像素必定是红色
const st = document.createElement('style');
st.textContent = '.chat-scroll-container, .chat-scroll-container * { color: #ff0000 !important; }';
document.head.appendChild(st);

// 2) 滚动 + 截图，再用页面里的 canvas 解码像素统计"红像素数/行"
//    （比人眼看截图可靠，可扫描上百个滚动相位）
const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
cv.getContext('2d').drawImage(img, 0, 0);
const d = cv.getContext('2d').getImageData(0, 0, w, h).data; // 逐行统计 r > g+40 && r > b+40
```

- 扫描要点：泄漏与**内容相位**绑定，必须扫滚动位置（整数步进即可，实测同一相位带内连续十几
  个位置可见）；同一个 f 值下静止一个位置很容易"复现不出"。
- 只看底部 2~3 行（`floor(面板底边)-1 .. +1`）；`.chat-bottom-fade` 若半透明会把文字透出来，
  会污染"红色计数"，做定量对比时要保证遮罩是实色或临时移除。
- **边框 A/B**：临时注入 `border: 1px solid … !important; .content-card::after { display:none }`
  即可回到"border 占布局"的旧几何，逐行亮度对比确认视觉等价。

## 八、观察计划

- 观察期内重点看：现象 1 是否在 125%/150% × 720p/1080p/2K 组合下复现（尤其输入区底边那行
  是否还有虚线）；现象 2 是否复现（若有元素又画出 sticky 盒外）。
- 复现时先跑第七节的"网格判据"：若 `(innerHeight - panelBottom) * dpr` 不是整数，
  说明有人动了 `.content-card` 的底边距/边框（或 `--gd-device-px` 没写进来）。
- 改动这一类几何时守两条约定：**面板底边以下的纵向偏移保持 4 的倍数 CSS px**；
  **不要让 sticky 子树里的元素画出盒外**。
