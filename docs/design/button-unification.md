# 按钮统一规范

## 结论

全项目只有一套按钮基座：`frontend/src/components/ui/GdButton.vue`（原生 `<button>` + `--gd-*` token，零 Element Plus 依赖）。

- 声明式按钮：业务组件直接使用 `<GdButton>`。
- 插件契约：`ui/register.ts` 全局注册 `GdButton`，运行时加载的插件 IIFE 只依赖「组件名 + props + `--gd-*` token」，不感知内部实现。
- Element Plus 的 `el-button` / `ElButton` 已全量移除（56 个文件 227 处）。ESLint 已禁止模板写 `<el-button>` / `<ElButton>`、禁止从 `element-plus` 导入 `ElButton`。

## API

### Props

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `type` | `default \| primary \| secondary \| danger \| error \| warning` | `default` | `error` 是 `danger` 的插件契约别名，两者渲染完全一致 |
| `size` | `tiny \| small \| medium`（`default` 视作 `medium`；`large` 暂未实现、回落 `medium`） | `medium` | 见下方尺寸表 |
| `disabled` | `boolean` | `false` | 原生 disabled |
| `loading` | `boolean` | `false` | 前置 spinner，自动 disabled + `aria-busy` |
| `plain` | `boolean` | `false` | 描边次要按钮。非 default：10% 类型色底 + 半透明类型色描边；default：**白底（surface）+ text 派生的半透明描边**，hover/active 逐级灌入 text。default 之所以单独定义：它的填充底是 5.5% text，与行 hover 的 `--gd-color-surface-subtle-hover` 同值，压在 hover 行上会糊成一片，必须靠白底 + 描边把自己凸出来 |
| `text` | `boolean` | `false` | 文字按钮：无底无边，类型色文字 + hover 浅底 |
| `link` | `boolean` | `false` | 链接按钮：类型色文字，hover 走透明度（对齐 el-button link 语义） |
| `border` | `boolean` | `false` | 填充按钮补描边 |
| `circle` | `boolean` | `false` | 正方形圆形图标钮（宽=height，去水平内边距） |
| `round` / `roundFull` | `boolean` | `false` | 胶囊圆角（`rounded-full`） |
| `block` | `boolean` | `false` | 撑满宽度 |

互斥优先级：`link` > `text` > `plain` > 填充。`circle` 与尺寸自动组合。

`default` 类型是**浅灰底中性按钮**（底色由 `text` 混入 `surface` 派生：亮色 ≈`#F2F2F2`，暗色自动反转为深灰），hover 9%、active 14% 逐级加深。不是透明无底色的裸按钮——那是 el-button 迁移前的误设，会导致「取消」类次要按钮在界面上几乎不可见。

### 尺寸表

档位整体比 zcode 上移一格命名（同尺寸的按钮叫更小的名字）：`medium` = 原 el-button 默认的 32px，
`small` = 28px，最小档叫 `tiny`（24px）。**所有档位统一 14px 字号**，只变高度 / 内边距 / 图标尺寸。
`large` 暂不实现——传入时回落 `medium`（`data-size` 也归一为 `medium`，主题钩子不会拿到空档位）。

| size | 高度 | 字号 | 图标 | 水平内边距 | line-height |
|---|---|---|---|---|---|
| `tiny` | 24px | 14px | 12px | 8px | 14px（`leading-none`） |
| `small` | 28px | 14px | 14px | 8px | 14px |
| `medium`（`default`，也是 `large` 的回落档） | 32px | 14px | 16px | 10px | 14px |
| `large` | 暂不实现（回落 medium） | — | — | — | — |

圆角默认 6px（`rounded-md`），`round` / `circle` 为全圆。

按钮显式设置 `line-height: 1`（`leading-none`）：不能让它继承 Tailwind preflight 的
`html { line-height: 1.5 }`——14px 字号会得到 21px 行盒，在固定高度的按钮里产生
半像素下偏移和上下不对称留白。三档高度、图标、行高全部为偶数整数，不存在亚像素余量。

### 图标

两种方式都支持，均受每档 size 的 `[&_svg:not([class*='size-'])]:size-*` 约束自动缩放：

```vue
<!-- 具名插槽（推荐：和文字内容分离，间距由组件控制） -->
<GdButton type="primary">
  <template #icon><Plus /></template>
  新建
</GdButton>

<!-- 默认插槽内直接放 svg/图标组件 -->
<GdButton link type="danger"><Delete />删除</GdButton>
```

图标组件不必再包 `<el-icon>`；显式传了 `class="size-*"` 的 svg 不受自动尺寸约束。

### 文字垂直居中（CJK 光学居中）

纯文字插槽会包一层 `span.gd-button__label`，用 CSS 标准属性
`text-box-trim: trim-both; text-box-edge: cap alphabetic` 把行盒裁到字形边缘
（cap 顶到基线）再交给 flex 居中。

原因：CJK 字体的 ascent/descent 不对称（14px 雅黑 ascent 15 / descent 4，汉字墨迹
只有 11/1），按行盒居中会恒定偏下约 0.5px。裁剪后居中作用于墨迹本身，无需 1px
padding 之类的魔法补偿。实测三档尺寸 label 上下留白完全相等（24px→6.7/6.7，
28px→8.7/8.7，32px→10.7/10.7）。

含图标/组件的插槽不走裁剪（`isTextOnlyLabel()` 判定），由按钮自身的 flex 居中，
避免影响图标基线。不支持 `text-box-trim` 的浏览器（Chrome < 133）自动退化为行盒居中，
不会错位只是偏下 0.5px。

### 事件

只声明 `click: [event: MouseEvent]`。`@click.stop` 等修饰符正常生效；`disabled` / `loading` 时原生 button 不触发 click。

### 主题钩子

根节点输出稳定的 `gd-button` 类名与 `data-variant`（归一后：`error`→`danger`）/ `data-size` 属性，供 `plugins/guada-themes` 的主题 CSS 定位：

```css
html[data-theme="winxp"] .gd-button { border-radius: 3px; }
html[data-theme="winxp"] .gd-button[data-variant="primary"] { /* ... */ }
```

**不要改名 `gd-button` 或移除 `data-variant` / `data-size`**，主题插件依赖这组钩子。

## 视觉令牌

`GdButton` 全部颜色来自 `--gd-*` 变量，主题（含 `html.dark` 与 11 套插件主题）覆盖变量即自动换肤。

| Token | 说明 |
|---|---|
| `--gd-color-primary` / `-hover` / `-active` / `-disabled` / `-text` / `-text-disabled` | 主色五态 |
| `--gd-color-secondary-*` | 辅助色五态（同构） |
| `--gd-color-danger` / `-hover` / `-active` / `-disabled` / `-text` / `-text-disabled` | 危险色五态（color-mix 派生） |
| `--gd-color-warning-*` | 警告色五态（同构） |
| `--gd-color-error*` | danger 系列的旧名别名（插件契约兼容） |
| `--gd-color-border` / `--gd-color-surface` / `--gd-color-text` / `--gd-color-text-disabled` | 中性色 |

组件内部通过局部变量（`--btn-bg` / `--btn-text` / `--btn-hover` / `--btn-border-*`）逐态接线，`plain` 与 `text` 变体的浅底用 `color-mix(in srgb, var(--btn-base-color) N%, transparent)` 派生。

交互细节：

- 只过渡颜色（`transition-colors duration-200`），不做 `transition-all`，避免批量触发非合成动画。
- hover 只在桌面端生效（`md:hover:` 前缀），触屏不出现粘滞 hover。
- disabled 走 token 化配色（非 opacity）──比透明度方案更贴合多主题体系。

## 迁移映射（el-button → GdButton）

| el-button | GdButton |
|---|---|
| 不写 type / `type="default"` | 同 |
| `type="primary"` / `"secondary"` | 同 |
| `type="danger"` | `type="danger"`（新增） |
| `type="warning"` | 同（token 已接通） |
| `size="small"/"default"/"large"` | `small`（28px）/ `medium`（32px，`default` 自动归一）/ `large`（暂未实现，回落 `medium`） |
| `:loading` | `loading`（内建 spinner） |
| `link` | `link`（同语义） |
| `text` | `text`（同语义） |
| `plain` / `round` / `circle` / `disabled` | 同 |
| `:icon="Xxx"` | `<template #icon><Xxx /></template>` |
| `<el-icon>...</el-icon>` 子内容 | 直接放图标组件（自动尺寸） |

兄弟按钮间距：不使用 el-button 的 `.el-button + .el-button` 自动 margin。多按钮行需要父容器显式布局（`flex gap-2`）；`GdDialog` 的 `#footer` 自带 `gap: var(--gd-dialog-gap, 8px)`，footer 内无需额外处理。

## 防回归

- `frontend/eslint.config.mjs`：
  - `vue/no-restricted-html-elements` 禁止模板写 `el-button` / `ElButton`（同时覆盖 `el-dialog` / `ElDialog`）。
    注意：不能用 `no-restricted-syntax` 的 `VElement` selector——核心规则不遍历模板节点，写了不生效
    （弹窗迁移期的旧规则即因此形同虚设，本次一并修正）；
  - `no-restricted-imports` 禁止从 `element-plus` 导入 `ElButton`。
- 主题插件 CSS 中的按钮定制已改为 `.gd-button` + `data-variant` 定位。
- `frontend/src/components/test/ui.vue` 是按钮全量视觉测试页（全部 type × size × variant 组合 + loading/circle/disabled 状态）。

## 遗留

- `el-icon`（304 处）不在本次范围，后续单独批次处理；图标本身不依赖按钮组件。
- Element Plus 仍全量注册供插件运行时使用；主应用模板已零 `el-button`。
