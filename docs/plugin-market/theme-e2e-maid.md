# 富主题端到端验证：maid-atelier 迁移

> 验证对象：`D:/AI/work/guada-theme-maid`（本地验证版，**不发布**）
> 上游：`Small-tailqwq/dsh-deep-whale` 的 `maid-atelier`（代码 MIT / 美术 CC BY-NC-SA 4.0）
> 结论：**GuaDa 的「主题 = 皮肤」模型可承载这类完整展示层主题**，端到端链路跑通；过程中发现并修复了 2 个宿主缺陷。

## 迁移做了什么

| 项 | 上游（dsh 皮肤） | 本版（GuaDa 富主题） |
|---|---|---|
| 入口 | `apply(ctx)` + `ctx.effect` | `registerTheme({ runtimeScript })` → `window.__GuaDaTheme__(api)` |
| 结构选择器 | 742 条（85 个 `[class*='xxx']`） | 约 70 条，只用 6 个 `data-gd-slot` 锚点 |
| 设计 token | 57 个 `--dsw-alias-*` | 映射到 40 个 `--gd-color-*` |
| 暗色判定 | `[data-ds-dark-theme]` | `html.dark` + `api.onModeChange` |
| 资源 | `skinAssetUrl()` 同源路由 | `api.assetUrl()` → `/plugins/:id/assets/<assetBase>/...` |
| 自建 DOM | characterStage / composerLaceRail / 视差 | `.maid-stage` + 两个 `.maid-character` |
| 设置 | skin-manager 协议（10 项） | `settings[]` + 设置页「主题配置」（4 项） |
| 美术 | 23MB | 9 个文件 / 3.0MB（只留 UI 必需） |

## 实测结果（2026-11-06）

环境：Windows 11 / Chrome（Electron 内嵌浏览器）/ Vite dev + Nest dev / 1440×900

### 1. 应用

| 检查 | 结果 |
|---|---|
| `html[data-theme]` | `guada-theme-maid.atelier` ✅ |
| `body[data-gd-theme-maid]` | 存在 ✅ |
| `<link data-gd-theme>` | 1 条 → `frontend/dist/theme-light.css` ✅ |
| `<script data-gd-theme>` | 1 条 → `theme-runtime.js` ✅ |
| `.maid-stage` | 存在，`background-image` = `assets/palace-light.webp`（HTTP 200）✅ |
| `.maid-character` | 2 个（left/right），320×480，贴内容区底部 ✅ |
| 壁纸压制 | `--wallpaper-image` 被置空 ✅ |

### 2. 亮/暗切换

- `html.dark` 变化后 → `<link>` 换 `theme-dark.css`，宫殿图换 `palace-dark.webp`，配色切到夜间海军蓝。
- 无闪烁、无残留旧 link。

### 3. 设置项

| 设置 | 操作 | 结果 |
|---|---|---|
| `showCharacters=false` | 保存 + `notifyThemeSetting` | `body[data-maid-characters="off"]` → 立绘 `display:none` ✅ |
| `brightness=95` | 同上 | `--maid-bg-brightness: 0.95` → stage `opacity: 0.95` ✅ |
| `brightness=80` | 同上 | 回到 `0.8` ✅ |

### 4. 卸载还原（关键）

切回 `default` 后逐项检查：

| 检查 | 结果 |
|---|---|
| `html[data-theme]` | `null` ✅ |
| `body[data-gd-theme-maid]` | `null` ✅ |
| body 上 `data-maid-*` 残留 | `[]` ✅ |
| `.maid-stage` / `.maid-character` | 已移除 ✅ |
| `link[data-gd-theme]` / `script[data-gd-theme]` | 0 ✅ |
| `--maid-*` / `--content-opacity` | 全部 `(unset)` ✅ |
| `--gd-color-bg` | 回到 `#222`（默认暗色）/ 原值 ✅ |

## 过程中发现并修复的宿主缺陷

### 缺陷 1：`assetUrl()` 没有拼 `assetBase`

`theme-runtime` 里 `api.assetUrl('palace.webp')` 生成 `/plugins/<id>/assets/palace.webp`，
但资源实际在 `<assetBase>/palace.webp`（如 `assets/palace.webp`）→ **全站 404**。

修复（`frontend/src/services/theme-runtime.ts`）：新增 `themePackageAssetUrl()`，
自动补 `manifest.assetBase` 前缀。`cssFile` 仍按插件根解析（不受影响）。

### 缺陷 2：主题设置无法写入

`PUT /plugins/:id/config` 只接受 `manifest.configSchema` 的键；
主题的 `settings` 不在 manifest 里 → 保存直接 400「declares no configSchema」。

修复（`backend-ts/src/modules/plugins/plugins.controller.ts`）：
允许键 = manifest 字段 **∪** 该插件所有主题的 `settings` 键。
这样主题设置与插件配置共用 `plugin:<id>` 数据，不引入新存储。

### 缺陷 3（插件侧，非宿主）：body 属性未托管

运行时最初用 `body.setAttribute('data-maid-*')` 直接写，卸载后残留 3 个属性。
改用 `api.setBodyAttribute()` 后，宿主记录原值并在卸载时清除 → 残留归零。

> 这条正好验证了「皮肤必须把 DOM 写入交给宿主」的设计意图：**自己写的属性，宿主无从还原。**

### 缺陷 4（宿主，已修复）：输入框没有可挂载的锚点

最初只能给 `[data-gd-slot='composer']`（整个输入区容器）加 `border-image`，
结果边框被 `.chat-column` 的自带圆角裁掉，且卡片只有 ~100px 高、九宫格边宽吃掉内容。

修复：`ChatInput.vue` 新增 `data-gd-slot="composer-card"`（真正的输入卡片）。
主题现在用 `composer-card::before` + 负 inset + `border-image` 做装饰，
与卡片内容分层（`::before` z-index 0，卡片子元素 z-index 1），不遮文字与菜单。

> **切图差异说明**：源图 `composer-frame.webp`（1800×588）是三边相框
> （左右描边约 20px、底部约 20px、顶部无横线，左上角落花纹在 x 50–119 / y 55–115）。
> GuaDa 的输入卡片高度只有 100px，九宫格切片无法在该尺寸下复现原始比例
> （角落花纹会被压扁或吃掉内容）。因此本版只做「三边框 + 金色描边」的等效表达，
> 通过 `--maid-frame-side` / `--maid-frame-bottom` 可调。
> **这是内容移植问题，不是机制问题**——`border-image` 九宫格本身工作正常。

## 与原版的视觉差异（验证范围内可接受）

1. **不是像素级复刻**：原版 742 条选择器覆盖 DSH 内部结构，本版只覆盖 6 个锚点；
   气泡圆角、工具栏图标、表格卡片、设置面板相框未迁移。
2. **立绘尺寸**：按内容区宽度 28% 贴底，未做原版的多视图视差与 `centerCol` 精确测量。
3. **字体**：原版给侧栏单独设 Georgia 衬线，本版未改。
4. **移动端**：未适配。
5. **顶栏花边**：`background-size: auto 100%` 拉伸较明显，原版是精确切片。

这些都不影响「机制可用」的结论。

## 结论

- 「主题 = 皮肤」的模型成立：纯 CSS 主题与富主题共用 `registerTheme`、同一条应用/卸载路径、
  同一份设置存储。
- 现有 11 个纯 CSS 主题**零改动**，与富主题并存（`rich: false/true` 区分）。
- 富主题的三条硬约束（互斥、可还原、资源同源）在真实主题上**全部成立**。
- 剩余工作量集中在**内容移植**（选择器改写、美术替换、移动端），机制层无需再改。

## 复现

```bash
# 1. 安装（开发机）
#    插件页 → 安装插件 → local:D:/AI/work/guada-theme-maid
# 2. 启用插件
# 3. 设置 → 外观 → 浅色/暗色主题 → 「深海女仆工坊」
# 4. 主题配置：亮度 / 双立绘 / 侧栏花边 / 简洁过程行
# 5. 切回默认主题 → 检查还原
```

卸载（验证完清理）：

```bash
curl -X DELETE http://127.0.0.1:3000/api/v1/plugins/guada-theme-maid
```
