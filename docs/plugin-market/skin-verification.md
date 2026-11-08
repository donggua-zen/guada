# 主题/皮肤机制验收清单

> v3 起主题与皮肤统一：`registerTheme` 支持纯 CSS 与「富主题」（原皮肤）。
> 统一模型说明见 `theme-skin-unification.md`。
>
> 用 `guada-skin-demo` 作为最小富主题（无美术资源，纯 CSS + 一个自建 DOM 层）。

## 前置

1. 运行带 v3 机制的后端 + 前端（`pnpm dev:backend` + `pnpm dev:web`）
2. 安装 demo 插件：

```
local:D:/AI/work/guada-skin-demo
```

3. 在插件页启用 `Skin Demo`
4. 设置 → 外观 → 浅色主题/暗色主题下拉里选「演示 · 完整主题」（带「完整主题」徽标）

## 后端验收（已完成）

```bash
curl -s "http://127.0.0.1:<port>/api/v1/plugins/slots" | jq '.themes[] | select(.rich)'
```

通过标准：

- `id === "guada-skin-demo.demo"`
- `rich === true`
- `cssFiles.light` / `cssFiles.dark` 均已下发
- `runtimeScript` / `assetBase` / `bodyAttribute` 已下发
- `settings` 3 项（含 `showIf`）
- `ownsBackground === true`
- 资源可达：`/plugins/guada-skin-demo/assets/frontend/dist/theme-{light,dark}.css` → 200
- 现有 11 个纯 CSS 主题仍为 `rich: false`，不受影响

## 前端验收

### 1. 选中富主题

设置 → 外观 → 选「演示 · 完整主题」。

通过标准：

| 检查 | 期望 |
|---|---|
| `html[data-theme]` | `guada-skin-demo.demo` |
| `document.body.getAttribute('data-gd-theme-demo')` | `""`（存在） |
| `<head> link[data-gd-theme]` | 1 条，指向 `theme-light.css`（亮色） |
| `<script data-gd-theme>` | 1 条（runtime） |
| `.demo-stage` / `.demo-ornament` | 各 1 个，挂在 body |
| `--demo-tint` | `var(--demo-tint-navy)` |
| `--wallpaper-image` | `none`（ownsBackground 生效） |
| 视觉 | 侧栏细线、对话区渐变、左上角角饰 |

### 2. 亮/暗切换

切到深色模式，通过标准：

- `<link>` 换成 `theme-dark.css`（旧的被移除）
- 角饰颜色变亮

### 3. 设置变更

在「主题配置」里改「背景色调 / 角饰尺寸」，保存。

通过标准：

- `--demo-tint` 变成对应变体
- `--demo-ornament-size` 变成新值
- 角饰视觉同步变化（无需重载）

### 4. 卸载还原（关键）

切回「默认」主题。逐项检查，**任一项残留即失败**：

| 检查 | 期望 |
|---|---|
| `html.hasAttribute('data-theme')` | `false` |
| `body.hasAttribute('data-gd-theme-demo')` | `false` |
| `.demo-stage` / `.demo-ornament` | 已移除 |
| `link[data-gd-theme]` / `script[data-gd-theme]` | 0 条 |
| `--demo-tint` / `--demo-ornament-size` | 还原为空 |
| `--wallpaper-image` | 还原为启用前的值 |
| 视觉 | 与启用前完全一致 |

### 5. 切到其他主题

从富主题切到 `cyberpunk`：

- 富主题的 body 属性、CSS、DOM、壁纸压制全部还原
- `cyberpunk` 正常生效

### 6. 插件禁用/卸载

停用 `Skin Demo`：

- `/plugins/slots` 的 `themes` 不再包含它
- SSE `plugins_changed` 触发后自动 `removeTheme()` 并提示「当前主题已被移除」
- 主题选择回退到 default

## 已知限制

1. 富主题的配置弹窗复用 `PluginConfigDialog`，其 schema 来自 `theme.settings`；
   数据仍存在 `plugin:<id>`，与插件「配置」页共用同一份。
2. 皮肤/主题与壁纸的取舍靠 `ownsBackground`；未声明的富主题若自绘背景，需要自己处理叠层。
3. 移动端锚点尚未补齐（当前只有桌面端 `data-gd-slot`）。
