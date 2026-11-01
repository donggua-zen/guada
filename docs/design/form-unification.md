# 表单控件统一规范（GdInput / GdSwitch / GdSelect）

## 结论

表单控件只有一套自研基座（`frontend/src/components/ui/`，原生元素 + `--gd-*` token，零 Element Plus 依赖）：

- 输入框：`GdInput.vue`（含 textarea / password / 字数统计 / autosize）
- 开关：`GdSwitch.vue`
- 下拉选择：`GdSelect.vue` + `GdSelectOption.ts`（`<GdOption>` 子组件）
- 下拉菜单：既有 `DropdownMenu.vue` / `DropdownMenuItem.vue`（本轮收编最后 3 处 el-dropdown）
- el-input（91 处）/ el-switch（26 处）/ el-select+el-option（124 处）/ el-dropdown（3 处）已全量移除。
- ESLint 已禁止模板写 `<el-input>` / `<el-switch>` / `<el-select>` / `<el-option>` / `<el-dropdown>` 系列，
  禁止从 `element-plus` 导入 `ElInput` / `ElSwitch` / `ElSelect` / `ElOption` / `ElDropdown*`。

## GdInput

### Props

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `modelValue` | `string \| number \| null` | `""` | `v-model` |
| `type` | `text \| textarea \| password \| number` | `text` | `number` 仅透传原生 `input[type=number]`（步进器需求用 el-input-number，未迁移） |
| `variant` | `filled \| outline` | **`filled`** | **filled = 灰底无边框（新默认形态）**；outline = 白底描边（= 原 el-input 视觉） |
| `size` | `tiny \| small \| medium`（`default` 归一 medium，`large` 回落 medium） | `medium` | 与 GdButton 同表：24 / 28 / 32px，统一 14px 字号 |
| `placeholder / disabled / readonly / clearable / showPassword / maxlength / showWordLimit / rows / autosize / resize / error` | — | — | 与 el 同名同义。`autosize` 支持 `boolean` 或 `{ minRows, maxRows }`；`error` 红描边 |

- `@keyup.enter`、`autofocus`、`spellcheck`、`inputmode` 等未声明属性经 `v-bind="$attrs"` 透传到原生 `<input>`/`<textarea>`，迁移零改写。
- `#prefix` / `#suffix` 插槽与 el 同名。
- 事件：`update:modelValue`（输入即发）、`input`、`change`（blur 时值有变化才发，对齐 el 语义）、`clear`、`focus`、`blur`。
- `ref` 方法：`focus()` / `blur()` / `select()`（对齐 el-input 的 `$refs.input.focus()`）。
- autosize 用 CSS `field-sizing: content` 实现（Electron Chromium ≥133），`minRows/maxRows` 换算 min/max-height，不跑 JS 测高。
- show-password：suffix 眼睛钮切换原生 `type`；clearable：有值且未禁用时 suffix 清空钮。
- show-word-limit：字数计数；textarea 时绝对定位右下角（对齐 el）。

### 视觉（variant）

- **filled（默认）**：底色 `--gd-color-field-bg`（text 4% 混入 surface，亮色 ≈#F2F2F2，暗色自动深灰），无边框（border 常驻 1px 透明占位）；hover 加深到 7%；focus 底回到 surface + 主色描边。
- **outline**：底 `--gd-color-field-outline-bg`（→ `--gd-color-input-bg`）、边 `--gd-color-field-outline-border`（→ `--gd-color-input-border`）。**引用 input token 是有意的**：ChatInput 容器与 11 套插件主题已覆盖 `--gd-color-input-*`，outline 形态自动继承主题换肤。

### token（style.css，亮暗各一套）

```
--gd-color-field-bg / -bg-hover / -bg-focus / -bg-disabled
--gd-color-field-text / -text-placeholder / -text-disabled
--gd-color-field-outline-bg / -outline-border / -outline-border-hover
--gd-color-field-focus-border（→ primary）
--gd-color-field-option-bg-hover / -option-bg-selected（GdSelect 面板）
--gd-switch-track-off / --gd-switch-thumb（GdSwitch）
```

全部由 `--gd-color-text` / `--gd-color-surface` / `--gd-color-primary` color-mix 派生或直接引用，
主题覆盖基础 token 即自动跟随，无需逐主题定义。

## GdSwitch

- 原生 `<button role="switch" aria-checked>`，轨道 `rounded-full` + 滑块 `translate-x` 过渡。
- Props：`modelValue`（boolean|string|number）、`activeValue` / `inactiveValue`、`disabled`、`loading`（滑块位换 spinner）、`size`（small 28×16 / medium 40×20，`default`/`large` 归一 medium）、`inlinePrompt` + `activeText` / `inactiveText`（轨道内文案）。
- 事件：`update:modelValue` / `change`。
- 选中轨 `--gd-color-primary`，未选中轨 `--gd-switch-track-off`（text 18% 透明）。
- `@click.stop` 等属性透传 fallthrough 到根 button。

## GdSelect + GdOption

### 两种 options 来源（可混用）

```vue
<!-- ① options prop（简单枚举） -->
<GdSelect v-model="x" :options="[{ label: 'A', value: 'a' }]" />

<!-- ② GdOption 子组件（el 兼容写法，支持自定义选项内容） -->
<GdSelect v-model="x">
  <GdOption v-for="o in list" :key="o.id" :label="o.name" :value="o.id">
    <img :src="o.avatar" class="w-6 h-6 rounded" /><span>{{ o.name }}</span>
  </GdOption>
</GdSelect>
```

`GdOption`（`GdSelectOption.ts`）自身渲染 null，setup 阶段经 `provide/inject`（`gdSelectContext.ts`）
同步注册进父 GdSelect；label/value/disabled 走 getter 保持响应式（`t(labelKey)` 随语言切换）。

### Props / 事件

| Prop | 说明 |
|---|---|
| `modelValue` | 单选 `string\|number`；多选 `Array<string\|number>` |
| `options` | `{ label, value, disabled? }[]`（与 GdOption 子组件二选一） |
| `filterable` | 输入即过滤（label 不区分大小写 includes），触发器内嵌输入框 |
| `multiple` | chips 平铺（无 collapse-tags 需求），chip 可单独移除 |
| `allowCreate` + `defaultFirstOption` | 查询无精确匹配时面板顶部出「新建 "query"」虚拟项；Enter 选中当前高亮项 |
| `clearable / loading / disabled / placeholder / size / variant / noDataText` | 同名同义 |

事件：`update:modelValue` / `change` / `visible-change`（面板开合，ConnectionSettings 用它拉容器列表）。

### 行为层（纯手写，零新依赖）

- 弹层复用 `GdPopover`（`align="start"` 新 prop：面板左缘对齐触发器；宽度跟随触发器）。
- 视口翻转、点击外部关闭、Esc、滚动跟随都是 GdPopover 内置能力。
- 键盘：Up/Down 循环移动高亮（跳过 disabled）、Home/End、Enter 选中、Esc 关闭；ARIA `role="combobox"/"listbox"/"option"` + `aria-activedescendant`。
- 触发器视觉与 GdInput 同一 token 套路（filled 灰底默认 / outline 白底描边），面板项 hover `--gd-color-field-option-bg-hover`。

### 与 el 的已知差异

- 弹层面板样式是 GdPopover 语言（毛玻璃 `bg-surface/70`），非 el 的纯白面板——与项目现有下拉（ModelSelectorPanel）视觉一致。
- el-dropdown 语义（命令菜单）不由 GdSelect 承担，用既有 `DropdownMenu`。

## 主题钩子（plugins/guada-themes）

| 组件 | 稳定钩子 |
|---|---|
| GdInput | `.gd-input` + `data-variant`（filled/outline）+ `data-size` |
| GdSwitch | `.gd-switch` + `data-size` |
| GdSelect 触发器 | `.gd-select` + `data-variant` / `data-size` |
| GdSelect 面板项 | `.gd-select-option`（面板容器 `popper-class="gd-select__panel"`） |

**不要改名这些类名**，主题插件依赖它们。winxp 已补：`.gd-input/.gd-select` 直角 + 内凹阴影、
`.gd-select-option` hover/选中经典 #316AC5；wandering-earth 的 message-box 方形输入同样覆盖了 `.gd-input`。

## 迁移映射（el → Gd）

| el | Gd | 注意 |
|---|---|---|
| `<el-input>` | `<GdInput>` | 属性同名透传；`autofocus` 在 GdDialogHost 场景用 `v-focus` 指令等价实现 |
| `<el-input type="textarea">` | `<GdInput type="textarea">` | `:autosize="{ minRows, maxRows }"` 同形 |
| `<el-switch>` | `<GdSwitch>` | `active-value/inactive-value` → `activeValue/inactiveValue`（可继续写 kebab 原名，Vue 自动转换） |
| `<el-select>` + `<el-option>` | `<GdSelect>` + `<GdOption>` | `:teleported` 不需要（GdPopover 本就 teleport body） |
| `<el-dropdown>` + menu/item | `<DropdownMenu>` + `<DropdownMenuItem>` | `trigger="hover"` 变点击触发（GlobalSidebar 用户菜单，交互轻微变化）；`divided` → `class="border-t border-(--gd-color-border)"` |
| `@change="fn"` 处理器 | 参数类型是 `string \| number \| (string \| number)[]` | 原 `(val: string)` 签名放宽为联合类型，函数体内 `String(val)` 归一 |

## GdInputNumber

数字输入（`GdInputNumber.vue`），包装 GdInput（`type="text"` + `inputmode="decimal"`），自动继承其视觉壳（filled/outline、尺寸表、主题钩子 `gd-input`——winxp 的直角+内凹阴影规则自动生效）。

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `modelValue` | `number \| null` | `null` | **null 透传**：空=未设置（temperature=null 表示用模型默认），非法输入 emit null，不强制回落 min/0 |
| `min / max / step` | `number` | `-∞ / ∞ / 1` | 边界与步长；小数步进按 step 的小数位数 round（0.1 步进不会出浮点尾巴） |
| `controls` | `boolean` | `true` | 右排上下步进钮（el 的 controls-position="right" 与默认左右形态统一收敛为此单形态）；`false` 纯输入 |
| `variant / size / placeholder / disabled / error` | — | — | 同 GdInput |

- 行为：输入过程自由键入不 clamp；blur / Enter 时 `parseFloat` 定值（空/非法 → null，合法 → clamp 到 [min,max]）；步进按钮按 step 增减并 clamp，null 时从 min（无边界则 0）起步
- `#suffix` 插槽透传（「Tokens」「秒」等单位）；事件 `update:modelValue` / `change` / `focus` / `blur`
- 主题钩子：根元素 `gd-input-number` + `data-size`（内部壳 `gd-input`）

## GdSlider

滑块（`GdSlider.vue`），zcode 范式：原生 `<input type="range">` 透明交互层 + 纯 CSS 视觉层（轨道圆角条 + 主色填充 + 白色 thumb）。

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `modelValue` | `number` | `0` | 拖动实时 emit |
| `min / max / step` | `number` | `0 / 100 / 1` | |
| `showInput` | `boolean` | `false` | 右侧并置 GdInputNumber（controls=false，双向联动） |
| `showTooltip` | `boolean` | `true` | 拖动/悬停时 thumb 上方值提示 |
| `formatTooltip` | `(v: number) => string \| number` | — | 提示文案格式化（GdSliderOptional 的「界外=Auto」） |
| `size` | `small \| medium` | `medium` | |

- 事件：`update:modelValue` / `input`（拖动实时）、`change`（松手/输入框 blur）——对齐 el 语义
- 主题钩子：`gd-slider` + `data-size`

### GdSliderOptional

「可选滑块」：滑到 `[min-step, max+step]` 界外段 = emit `null` = tooltip/输入框显示 `optionalText`（默认 "Auto"）。内部已是 GdSlider + GdInput，零 el 依赖。生产暂无调用方（仅测试页）。

## 迁移映射（el → Gd）补充

| el | Gd | 注意 |
|---|---|---|
| `<el-input-number>` | `<GdInputNumber>` | `controls-position="right"` 属性直接删（单形态）；`:controls="false"` 同名保留；`precision/formatter` 未迁（0 用量） |
| `<el-slider>` | `<GdSlider>` | `:show-input-controls="false"` 直接删（showInput 收敛无步进钮）；`range/marks/vertical` 未迁（0 用量） |

## 防回归（frontend/eslint.config.mjs）

- `vue/no-restricted-html-elements` 禁止模板写 `el-input` / `el-switch` / `el-select` / `el-option` / `el-dropdown` 系列 / `el-input-number` / `el-slider`（含 PascalCase）。
- `no-restricted-imports` 禁止从 `element-plus` 导入 `ElInput` / `ElSwitch` / `ElSelect` / `ElOption` / `ElDropdown*` / `ElInputNumber` / `ElSlider`。
- 注意该类规则必须用 `vue/no-restricted-html-elements`，`no-restricted-syntax` 的 VElement selector 不遍历模板节点（按钮批次已验证）。

## 遗留（下一批去 Element 化）

- `el-slider`（9 处）已随 GdInputNumber 批次完成迁移；GdSliderOptional 重写为零 el 依赖。
- `ElMessage`（约 187 处真实调用）/ `ElNotification`（业务 0 处，全在 usePopup.notify 内部）/ `v-loading`（1 处）命令式提示体系 → 自研 GdToast（零主题 CSS 债务，zcode toast.tsx 可参考）。
- `el-radio` 系（17 处，radio-button 本质是分段选择器）、`el-checkbox` 系（22 处，checkbox-button 集中在 ModelsProviderDetail 且自带 ~150 行待删仿制 CSS）。
- `el-tag`（62 处/21 文件，存量最大、形态单一）、`el-progress`（6）、`el-tabs`（3）、`el-empty`（3）、`el-collapse`（2）、`el-badge`（1）、`el-tree`（1，最重，单独批次）、`el-table`（5，仅测试页）。
- `el-date-picker`（2）+ `el-time-picker`（1）：全在 scheduler，datetime + HH:mm 窄需求，GdPopover + 月历网格可覆盖。
- `el-upload`（2）：纯「拖拽区+文件选择壳」，上传逻辑 100% 自研，原生 input[type=file] 即可替代。
- `el-form` / `el-form-item`（16/75 处）布局与校验体系；GdInput 预留 `error` prop 接手动校验。
