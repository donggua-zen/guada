# 输入区底部泄漏与 sticky 抖动——亚像素专项留档（观察期）

> 状态：**观察期**。当前采用「底部遮罩改实色 + 覆盖条停用」的组合，用户实测"似乎修好了"。
> 本文留档现象、机制、迭代史与备选方案，供观察期内复现时对号入座。
> 关联提交：`8dba24ca` → `4d2b2940` → `3f0fd1c2` → 当前。

## 一、现象（三个，常被混为一谈）

| # | 现象 | 出现条件 |
|---|---|---|
| 1 | 输入区底部漏出内容：工作目录条下方的透明带透出滚动消息（1px~数 px，发虚） | 非整数缩放（1080p@125%）或内容含分数高度；滚动位置相关 → **偶发** |
| 2 | 滚动时输入区跟随滚动抖动：滚动中输入区 top 在 ±8px 摆动（实测 931↔939 @1080 视口），停止后回正 | 遮罩以负 bottom 画出 sticky 盒外时必现 |
| 3 | 渐变遮罩渐隐带（20px）半透明，内容从带里透出 | 渐隐带覆盖的几何区间与内容行对齐时，易与 #1 混淆 |

2K@100% 三个现象都不出现（当时内容总高恰为整数）。

## 二、机制（实测数据）

### 1) 分数缝（现象 1）

- 非整数缩放下内容高度是分数：窗口 CSS 高 = 物理 ÷ 1.25（多为分数），行高 ×dpr 带小数。
- `scrollTop` / `scrollHeight` 取整 → 滚到底时**内容末端与滚动口底边之间留 0~1 CSS px 的缝**（设备端 ×dpr）。
- 输入区（`position: sticky; bottom: 0`）钉在滚动口底边，其盒内遮罩（渐变或实色）**覆盖不到盒外的这条缝** → 滚动消息从缝里透出。
- 实测：zoom 1.25 模拟下，滚到底时输入区底边 1073.5 vs 滚动口底边 1074（差 0.5px）；
  dpr=1 对该内容扫描 600px 滚动范围缝恒 0（总高恰为整数）→ 复现不出，与"2K 严丝合缝"一致。

### 2) sticky 抖动（现象 2）

- 遮罩以负 `bottom` 画出 sticky 盒外（去盖缝隙）→ **sticky 退回主线程更新**：
  合成器先滚动、主线程后应用 sticky 偏移 → 输入区跟随内容 8px 再追上。
- 变量隔离实测（1080 视口、滚轮滚动 + rAF 采样输入区 top）：
  遮罩 `bottom: 0 / 76px` → **spread 0**（恒 939）；`bottom: -8px / 84px` → **spread 8**（931↔939）。

### 3) 渐隐带透出（现象 3）

- 底部渐变遮罩 `linear-gradient(to top, bg 56px, transparent 76px)` 的顶部 20px 是半透明渐隐带，
  内容从带里透出是**设计行为**（渐隐），但几何对齐时容易被当成泄漏。

## 三、方案迭代史

| 提交 | 方案 | 结果 |
|---|---|---|
| `8dba24ca` | 遮罩下探 2px（bottom -2px / height 78px） | 部分分辨率仍漏 |
| `4d2b2940` | 下探 8px（bottom -8px / height 84px，断点同步 +8） | 泄漏被盖，**但引入现象 2**（滚动抖动 8px） |
| `3f0fd1c2` | 遮罩还原 0/76 + 滚动容器外覆盖条 `.chat-bottom-residue-cover`（3px，页面背景同色） | 现象 2 归零（spread 0）；覆盖条像素级生效（hash A/B），但用户环境判定无效（原因待观察，见"观察计划"） |
| 当前 | 底部遮罩改**实色** `background: var(--gd-color-bg)`（无渐隐带）+ 覆盖条停用（代码保留） | 用户实测"似乎修好了"，**观察期** |

## 四、关键教训

1. **不要用负偏移让元素画出 sticky 盒外**：会破坏合成器驱动的 sticky（退回主线程）→ 滚动抖动。
2. 泄漏缝在 sticky 盒外 → **盒内任何遮罩（渐变/实色）都盖不住** → 只能：
   a) 滚动容器外覆盖（不受裁剪、不碰 sticky 盒）；或
   b) 在滚动容器自身上做 `mask-image`（Qoder 方案，见下）。
3. 实色遮罩的代价：composer 上方 76px 的消息**硬切**（无渐隐）——观察期接受；
   若不满意，回到"渐变 + 外部覆盖条"组合，或移植 Qoder 的 mask 方案。
4. "泄漏"与"卡片底边框"要分开看：浅灰细线是 `.content-card` 自己的 1px 底边框
   （`--gd-layout-card-border` #e8e8e8，卡片浮在窗口底边上方 4px，对齐 Qoder 的内容卡设计），
   **本来就该显示**；泄漏的文字顶行紧贴在它上方一行，视觉上像边框断成虚线。

## 五、参考实现对照

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
  即**在滚动容器自身上做 mask**，渐隐高度由 CSS 变量控制（`--q7d1dca` 默认值未提取）。
  结构上规避了覆盖层的全部坑（负偏移 / z 序 / 合成层交互）。
- **若观察期后仍不满意，优先移植此方案**：给 `.chat-scroll-container` 加
  `mask-image: linear-gradient(to top, transparent, black Npx)`（N = 渐隐带高度），
  并移除盒内渐变遮罩元素。代价：mask 会让滚动容器整层重栅格（性能需实测）。

### asar 读取脚本（Qoder 未加密，直接可读；保存为 `asar-read.mjs`）

```js
import { readFileSync, writeFileSync } from "node:fs";
const [asarPath, target, outPath] = process.argv.slice(2);
const buf = readFileSync(asarPath);
const headerSize = buf.readUInt32LE(4);
const dataStart = 8 + headerSize;
// JSON 目录区：从第一个 '{' 到数据区起点，尾部可能是 NUL/空格填充
const jsonStart = buf.subarray(0, 32).indexOf(0x7b);
const jsonRaw = buf.subarray(jsonStart, dataStart).toString("utf8").replace(/[\u0000\s]+$/, "");
const dir = JSON.parse(jsonRaw);
const parts = target.split(/[\\/]+/).filter(Boolean);
let node = dir;
for (const p of parts) { if (!node.files?.[p]) { console.error("NOT FOUND:", p); process.exit(2); } node = node.files[p]; }
if (node.files) { console.error("IS DIR"); process.exit(3); }
const start = dataStart + Number(node.offset);
writeFileSync(outPath, buf.subarray(start, start + node.size));
console.log(`OK ${target} size=${node.size}`);
// 用法：node asar-read.mjs "<asar>" "out/renderer/assets/index-xxx.css" out.css
```

## 六、排查工具与复现配方

- **运行时审计**：dev 控制台 `__subpixelAudit()`（`src/utils/devSubpixelAudit.ts`，dev-only）；
  注意它扫 rect，**看不到边框宽度的小数**，后者用静态检查。
- **静态检查**：`npm run check:subpixel`（`scripts/check-subpixel.mjs`）。
- **复现配方**（现象 1/2）：
  1. dev 起服务，打开长会话；
  2. `document.documentElement.style.zoom = '1.25'`（模拟非整数缩放）；
  3. `sc.scrollTop = sc.scrollHeight - sc.clientHeight - 300`（让消息行经过输入区底部透明带）；
  4. 截图底部 20px 条带对比；现象 2 用"滚轮滚动（合成器路径）+ rAF 采样 `.chat-input-area` top"量化 spread。

## 七、观察计划

- 观察期内重点看三个现象（见"一"）在 125%/150% × 720p/1080p/2K 组合下是否复现。
- 若现象 1/3 复现 → 移植 Qoder 的 `mask-image` 方案（第五节），并实测滚动性能；
- 若现象 2 复现 → 检查是否有元素又画出了 sticky 盒外；
- 任何一处分辨率稳定复现后，把缩放比例、窗口尺寸、截图补进本文档。
