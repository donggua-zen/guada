# 主题 = 皮肤（v3 统一模型）

> 结论：**主题和皮肤不是两个东西**。一个主题可以只是配色，也可以是完整展示层。
> 代码里只有 `registerTheme`，`registerSkin` 是它的兼容别名。

## 一个类型，两个档位

`ThemeRegistration` 同时覆盖两种形态：

| 档位 | 声明 | 宿主行为 |
|---|---|---|
| **纯 CSS 主题** | `cssFile` 或 `cssFiles` | 插一个 `<link>` + 设 `html[data-theme=x]`，只改变量 |
| **富主题**（原「皮肤」） | 额外给 `runtimeScript` / `assetBase` / `bodyAttribute` / `settings` | 再打 `body[data-gd-theme-x]`、执行运行时脚本、可压制壁纸、可带设置项 |

判断依据只有一个：

```ts
isRichTheme(t) = Boolean(t.runtimeScript || t.assetBase)
```

## 为什么合并

1. **用户心智只有一个**：设置页里就是"选主题"，不该出现"主题"和"皮肤"两个列表。
2. **互斥天然成立**：皮肤本来就只能选一个，主题也只能选一个，合并后规则统一。
3. **优先级不再需要解释**：原来「皮肤 > 主题」是因为 body 比 html 近；合并后没有两层，只有"这个主题自己的作用域"。
4. **卸载语义统一**：两者都要求"切走时完整还原"，一套 `removeTheme()` 就够了。

## 层级关系（合并后）

```
html.dark                          亮/暗（系统级）
  html[data-theme="x"]             主题：变量覆盖（纯 CSS 主题的全部工作）
    body[data-gd-theme-x]          富主题：作用域（可选，只有富主题有）
      [data-gd-slot='sidebar']     ...  结构锚点
```

纯 CSS 主题只用到第二层；富主题用到第三、四层。**同一个 API，不同深度。**

## 迁移对照

| v2.2（皮肤） | v3（统一） |
|---|---|
| `api.registerSkin({...})` | `api.registerTheme({...})`（`registerSkin` 仍可用，等价） |
| `SkinRegistration` 类型 | `ThemeRegistration`（`SkinRegistration` = 它的别名） |
| `/plugins/slots` 的 `skins[]` | `themes[]` 里带 `rich: true` 的项；`skins[]` 仍返回（兼容） |
| `skin-runtime.ts` | `theme-runtime.ts`（已删除前者） |
| `body[data-gd-skin-x]` | `body[data-gd-theme-x]` |
| `window.__GuaDaSkin__(api)` | `window.__GuaDaTheme__(api)` |
| `localStorage['gd:active-skin']` | 沿用主题选择 `lightThemePreset` / `darkThemePreset` |

## 与已有主题的关系

现有 11 个纯 CSS 主题（`plugins/guada-themes`）**零改动**：

- 它们的 `registerTheme({ id, name, cssFile })` 仍然有效；
- 下发时多一个 `rich: false` 字段，前端只在 `rich: true` 时显示「完整主题」徽标和配置入口；
- 主题切换逻辑不变，只是加载路径从 `themes/index` 内联实现换成了 `theme-runtime`。

## 与壁纸的关系

壁纸（`--wallpaper-image` + `body::before`）是独立一层，未来可能下线。富主题可声明：

```ts
ownsBackground: true
```

宿主在应用时把 `--wallpaper-image` 置 `none` 并移除 `wallpaper-loaded`，卸载时还原。这样富主题自绘背景不会和壁纸叠成脏图。

## 设置页形态

```
主题模式
  显示模式   [浅色][深色][系统]
  浅色主题   [下拉：默认 / 喜鹊 / cyberpunk / … / 演示·完整主题 ⬅ 带徽标]
  暗色主题   [下拉：同上]

  ┌ 主题配置（仅当选中富主题时出现）────────────────┐
  │ 该主题自绘背景，已临时关闭壁纸。        [配置]  │
  └──────────────────────────────────────────────┘
```

「配置」打开通用 `PluginConfigDialog`，schema 来自该主题的 `settings`；保存后调用
`notifyThemeSetting(key, value)`，主题运行时无需重载即可响应。

## 代码位置

| 职责 | 文件 |
|---|---|
| 类型定义 | `backend-ts/src/modules/plugins/types/plugin.types.ts`（`ThemeRegistration`） |
| 注册表 | `.../registry/plugin-registry.ts`（`registerTheme` / `getThemes`） |
| 下发 | `.../plugins.controller.ts`（`GET /plugins/slots` 的 `themes[]`） |
| 配置写入 | `.../plugins.controller.ts` `PUT /plugins/:id/config`（允许键含主题 `settings`） |
| 运行时 | `frontend/src/services/theme-runtime.ts` |
| 注册表 + 应用入口 | `frontend/src/themes/index.ts`（`applyThemePreset`） |
| 选择 UI | `frontend/src/components/setting/AppearanceSettings.vue` |
| 语义锚点 | `docs/plugin-market/skin-anchors.md` |
| 端到端验证 | `docs/plugin-market/theme-e2e-maid.md`（maid-atelier 迁移实测） |

## 已验证的边界

用真实主题（maid-atelier，9 个资源 / 双立绘 / 亮暗两套）跑过完整链路：

- ✅ 应用、亮暗切换、设置项实时生效
- ✅ 卸载后 `data-theme` / body 属性 / CSS 变量 / link / script / 自建节点**零残留**
- ✅ 与现有 11 个纯 CSS 主题共存

过程中发现并修复了两个宿主缺陷（详见 `theme-e2e-maid.md`）：

1. `api.assetUrl()` 未拼 `assetBase` → 资源 404；
2. `PUT /plugins/:id/config` 不接受主题 `settings` 键 → 主题设置无法保存。
