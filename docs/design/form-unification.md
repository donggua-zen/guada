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

## GdTag / GdAlert / GdProgress / GdDivider / GdEmpty（第五批小散件）

### GdTag（替代 el-tag，62 处/21 文件）

| Prop | 说明 |
|---|---|
| `type` | `info/success/warning/danger/primary/error`（error→danger 归一，插件契约别名） |
| `effect` | `light` 软色底（默认，`bg-[色]/12%`）/ `plain` 描边（`border-[色]/45%`）/ `dark` 实色反白 |
| `size` | `small` 24px（默认，对齐 GdButton tiny）/ `medium` 28px |
| `closable` | 尾部内联 X 钮，emit `close`（唯一直实消费：ChatInput 知识库/附件标签） |

五色走 `--gd-color-info/success/warning/danger/primary` token；`gd-tag` + `data-type`/`data-effect`/`data-size` 主题钩子（5 条主题 `.el-tag` 圆角规则已移植为 `.gd-tag`）。el-tag 的 round/hit/color/disable-transitions/@click 全项目 0 用量未实现。

### GdAlert（替代 el-alert，15 处/7 文件）

`type`（warning/info/error/success，保持 el 的 error 命名）、`showIcon`（默认 false 同 el）、`title`/`description` prop 与默认插槽等价渲染。软色调 `border-[色]/35% bg-[色]/10%`；closable 不做（15/15 全禁用）。图标复用 `ui/semanticIcons.ts`（与 GdToastHost 共享）。

### GdProgress（替代 el-progress，6 处/5 文件）

line 型；`strokeWidth`（3/6/8 三档实测）、`showText`、`indeterminate` 流光（CSS keyframes，UpdateDialog/AboutPanel 硬需求）、`color`（hex 或 `(p) => string` 函数，MemoPanel 三段渐变）、`status` 语义色。`gd-progress` + `data-status` 钩子。

### GdDivider（替代 el-divider，8 处/5 文件）

`direction` horizontal/vertical；`contentPosition` left/center/right 文字插槽（left = 短线+文字+长线）。`gd-divider` + `data-direction` 钩子。

### GdEmpty（替代 el-empty，3 处/1 文件）

极简线稿空态（不搬 EP 插画）：`description` + `imageSize`（图标边长）。

### el-badge / el-link 去组件化

- el-badge（1 处）→ 就地 span 数字气泡（`h-4 rounded-full bg-warning text-white text-[11px]`）
- el-link（1 处）→ `GdButton link type="primary"`（带图标）

## GdFormField + useFormValidation（el-form 系 91 处已迁出）

**表单布局**：`GdFormField.vue`——label + 控件 + 行内红字三明治（zcode FieldError 范式）。
- 无 `labelWidth`：纵排（label 在上）；传 `labelWidth="120px"`：label 左置固定宽右对齐（对齐 el label-position="left"）
- `required` 星号纯视觉；`error` prop 有值时显示行内红字 `role="alert"`；`hideRequiredAsterisk` 同 el
- 钩子：`gd-form-field` + `data-error`。**控件的红描边手动接线**：`<GdInput :error="!!errors.x" @blur="validateField('x')" />`（GdInput/GdSelect/GdInputNumber 均支持 error prop）

**校验**：`composables/useFormValidation.ts`——`useFormValidation(schema)`（schema 支持 `MaybeRef`，动态规则用 computed）：
- 规则五类直接函数表达（required/正则/长度/一致性/async 查重名），返回 `string | null`
- `validate(): Promise<boolean>`（聚合，等价 el validate）、`clearValidate(fields?)`（弹窗开关清态）、`validateField(field)`（增量触发）、`errors` reactive（行内红字）
- 不依赖 async-validator；`validateField`/`resetFields` 因 0 用量未迁（resetFields 语义=重置值+清态，迁移处手动重置表单对象）

**范式样板**：`SchedulerTaskEditView.vue`（迁移前就有的手写校验）与 `LoginPage.vue`（本批迁移后）。

## GdCheckbox / GdSegmented / GdRadio（el-checkbox 22 处 + el-radio 17 处已迁出）

- **GdCheckbox**：自绘方块（size-4，checked 主色底白勾）+ sr-only 原生 input；`v-model` 与受控 `:model-value + @change` 双兼容；`label` prop 或默认插槽（富文本两行内容）。**GdCheckboxGroup**：数组 v-model，组内 `:model-value="arr.includes(x)"` 写法
- **GdSegmented**（横排分段单选，替代 el-radio-button）：中性描边胶囊 + 主色圆点指示器（ModelsProviderDetail 手工调好的视觉收敛为组件）；`options: { label, value, icon?, disabled? }[]`；键盘左右箭头 + `role="radiogroup"`
- **GdRadio + GdRadioGroup**（竖排选项卡）：圆点 mark + 富文本插槽（KBFileUploader 标题+描述形态）；provide/inject 组契约
- 钩子：`gd-checkbox`/`gd-segmented`/`gd-radio` + `data-checked`/`data-value`

## GdTabs / GdPagination / GdCollapse（el-tabs/pagination/collapse 已迁出）

- **GdTabs**：仅 tab 头部条（内容由消费方 v-if/v-show 自渲染）。`tabs: { name, label, icon? }[]` + `v-model` + `@change`；下划线式一级形态（h-11、15px、active 主色下划线）；左右箭头循环 + `role="tablist"`；钩子 `gd-tabs` + `data-active`。卡片/lazy/可关闭 0 用量未做
- **GdPagination**：`total/pageSize` + `v-model`（或 `:model-value` + `@change` 单向）；`hideOnSinglePage`；页码窗口算法（首尾常驻 ±1 窗口省略号）；`size: small|medium`；钩子 `gd-pagination` + `data-size`
- **GdCollapse**：单项形态（BotModal「高级设置」场景）。`name` + 数组 `v-model` + `#title` 插槽；`grid-template-rows: 0fr/1fr` 纯 CSS 展开动画 + chevron 旋转；钩子 `gd-collapse` + `data-open`
- **el-upload 去组件化**（2 处）：自绘拖放/点击区 + 隐藏 `<input type="file" class="sr-only">`；`clearFiles()` → `input.value = ''`（天然无 limit 二次拒绝）；上传逻辑本就自研（取 `e.target.files[0]`）

## 图标范式（el-icon 322 处已迁出）

**图标不建 wrapper**：直接渲染 `@vicons/fluent` 组件 + Tailwind 尺寸类，与 zcode 的裸 lucide 范式一致。

```vue
<Checkmark16Regular class="w-4 h-4" />                 <!-- 16px -->
<ArrowSync16Regular class="w-3.5 h-3.5 animate-spin" /> <!-- 14px + 旋转 -->
<ChevronDown12Regular class="w-3 h-3" :class="{ 'is-open': open }" /> <!-- 动态类数组共存 -->
```

- 尺寸刻度：12→w-3、14→w-3.5、16→w-4、18→w-4.5、20→w-5、24→w-6、32→w-8、48→w-12（奇数零散值 11/13/22/26 用任意值）
- 旋转：`animate-spin`（原 el-icon 的 is-loading）
- 尺寸机制差异：vicons 组件是无 width/height 的裸 svg，**必须显式给尺寸类**（在 GdButton/GdInput 插槽内可省，内部 `[&_svg:not([class*='size-'])]:size-*` 自动兜底）
- `text-center` 容器里的大图标补 `mx-auto`（preflight 把 svg 设为 display:block）
- 唯一保留的「盒」：GdDialogHost 的 `.gd-modal-icon`（22px 盒内 16px 字形居中，span 包裹）
- font-size 型语义类（`.gd-option__icon` 等）已改显式 width/height（el-icon 的 1em 机制消失）
- ESLint 禁 `<el-icon>` 模板与 `ElIcon` 导入

## 防回归（frontend/eslint.config.mjs）

- `vue/no-restricted-html-elements` 禁止模板写 `el-input` / `el-switch` / `el-select` / `el-option` / `el-dropdown` 系列 / `el-input-number` / `el-slider` / `el-tag` / `el-alert` / `el-divider` / `el-progress` / `el-empty` / `el-badge` / `el-link`（含 PascalCase）。
- `no-restricted-imports` 禁止从 `element-plus` 导入上述对应的 PascalCase 名称。
- 注意该类规则必须用 `vue/no-restricted-html-elements`，`no-restricted-syntax` 的 VElement selector 不遍历模板节点（按钮批次已验证）。

## no-undef 兜底（2026-11，浮层批新增）

vue-tsc 不检查 `<script setup>`（无 `lang="ts"`）的文件与 src 下 3 个 .js 文件（main.js / plugin-loader.js / usePluginI18n.js）——「import 被迁移脚本吃掉」曾在这里静默存活（MCPServers 的 `usePopup is not defined`，HEAD 1941dd15 就已引入）。ESLint 配置新增一块：全部 vue + src/**/*.js 开 `no-undef: error`，globals 走 `globals.browser` + 3 个 Electron ambient 接口登记（vite-env.d.ts）。lang="ts" 文件 TS 类型引用不进 ESLint 作用域分析，不误报。上线即揪出第 5 处真 bug：UserProfile.vue 用 `router.replace` 但没 `useRouter()`。

## GdImageViewer / GdDrawer（第九批浮层组件，el-image-viewer 2 / el-drawer 1 / el-table 1 已迁出）

- **GdImageViewer**：全屏图片查看器。`urls: string[]` + `visible`（v-model:visible）+ `initialIndex`；循环切换（取模收敛）、ArrowLeft/Right、Esc、点遮罩关闭；加载 spinner + 失败态（`data-failed` 隐藏 img）；z 走 `--gd-z-viewer: 3000`（高于 modal 2000 低于 toast 4000）；滚动锁与 GdDialog 同引用计数模式；钩子 `gd-image-viewer`
- **GdDrawer**：右侧抽屉。`v-model` + `title` + `size`（宽度，默认 480px）+ `destroyOnClose`（首开前不渲染 slot）+ `closeOnClickModal/closeOnPressEscape`；遮罩 fade + 面板 translateX 滑入（`--gd-motion-duration-dialog`）；模块级单调 z-index 与 GdDialog 同基线；钩子 `gd-drawer`；style.css 两处 `--el-drawer-*` 主题覆盖随迁移删除
- **el-table 去组件化**（SplitpanesPerfTest 测试页）：4 行静态对比数据用原生 `<table>` + 局部样式，无需 GdTable
- locale 新增：`common.imagePreview / imageLoadFailed / prevImage / nextImage`（zh/en）

## GdDatePicker / GdTimePicker（第十批，el-date-picker 2 / el-time-picker 1 已迁出）

- **gdDateTime.ts**：纯日期逻辑（42 格日历 buildMonthCells 周日起始、splitDateTime/combineDateTime 往返、非法/越界回退当前时间、clamp），node 单测 14 用例；转换器语义镜像自 scheduler/schedule.ts（ui 层不反向依赖 feature 目录）
- **GdDatePicker**（datetime 形态）：模型 = `"YYYY-MM-DD HH:mm:ss"` 字符串。触发器复制 GdSelect 触发器壳（`gd-date-picker` 基类 + data-open + filled token 族，size small=26px/default=32px，CalendarLtr16Regular）；面板内嵌 GdPopover（width 300, align start）：‹›翻月 + Intl.DateTimeFormat 月标题 + 星期行（zh 取末字/en 取前两字母）+ 7 列日格（非本月淡化/今天主色描边/选中实底反白）+ 底部时:分:秒三个 tiny GdInput + 「此刻」「清除」
- **GdTimePicker**（HH:mm）：同一触发器壳（Clock16Regular）；面板两列滚动列表（00-23 / 00-59，28px 行 tabular-nums，选中主色反白），打开时 scrollIntoView 定位选中行
- **即时 emit 模型**：点日格/改时间/点行立即 emit，面板不自动关（点外/Esc 关，沿用 GdPopover）——对齐 GdSelect 的即选思路但保留面板便于微调时间
- **迁移**：ScheduleSentence（once 频率 + 每日/每周时间；`.sched-*` 胶囊圆角保留、删 `:deep(.el-input__wrapper)` hack 块，本文件 `--el-*` 清零）；SchedulerTaskEditView（expiresAt clearable，19 处 `--el-*` 批量替换为 `--gd-*` 映射：fill-color-light→field-bg、text-secondary→text-gray、danger-light-9→danger-0f 回退等）
- locale 新增：`common.now / prevMonth / nextMonth / hour / minute / second`（zh/en）
- ESLint 禁 `el-date-picker / el-time-picker` 模板与 `ElDatePicker / ElTimePicker` 导入

## 收官批（2026-11）：GdTree + element-plus 整体卸载 —— 去 Element 化完成

- **GdTree**（el-tree 1 处已迁出）：只读展示树三件套——GdTree.vue（provide 上下文）+ GdTreeBranch.ts（defineComponent 递归渲染，子级缩进 +16px）+ gdTreeContext.ts（InjectionKey）。窄契约：`data + idKey/labelKey/childrenKey + v-model:selected + @node-click + #node 插槽`；无折叠/拖拽/异步/多选（0 用量不做）。KBFileTree 移动弹窗 labelKey="displayName" 接入
- **element-plus 整体卸载**（2.14.4 → 0）：
  - 前置债清偿：全库 ~200 处 `--el-*` CSS 变量按桥接映射表替换为 `--gd-*`（text-secondary→text-gray、fill-light→field-bg、color-light-N→primary-N、danger-light-9→danger-0f 回退等），Tailwind 括号形态 `text-(--el-color-primary)` 7 处一并处理；替换后 grep 全库归零
  - 拆除链：App.vue `el-config-provider` locale 包装（直接移除，RouterView 顶出）→ main.js 两行 EP CSS import / `app.use(ElementPlus)` / `__GuaDaShared__["element-plus"]` 注入（插件零消费已验证）→ vite.config 两个 `ElementPlusResolver` → `pnpm remove element-plus` → dts 重生（auto-imports.d.ts 清空 ElMessage/ElNotification 声明）→ plugin-runtime.d.ts 契约删 `'element-plus'` 键 → style.css 两个主题桥接块（22 处 --el-* 定义）删除
  - main.js 遗留仅一行注释说明卸载事实
- **AgentSettingPanel 模板损伤修复**（早先 el-form 批次遗留，编译器级才能发现）：el-form/el-form-item 换 div 时 6 处闭合缺失（basic 尾 1 + 四个工具 tab 各 1 + 根层 1）。**教训**：vue-tsc 与 ESLint 均不做模板开合配平检查，只有 vite build（编译器）会报——大迁移后必须跑一次 build + 全库 `vue/compiler-sfc parse` 普查（本次 210 个模板全部 OK）
- **防回归终态**：ESLint `vue/no-restricted-html-elements` 已覆盖全部 el 组件（含 el-tree/el-config-provider），`no-restricted-imports` 对 `element-plus` 包整包禁入（不限 importNames）
- **验证**：typecheck 干净、841 测试全绿、build 通过、210 模板 parse OK、`--el-`/`element-plus`/`<el-` grep 全归零、lint 仅剩 8 个 HEAD 既有 no-explicit-any

## 后记

全部完成：自第十批与收官批后，主应用模板与运行时零 Element Plus 依赖（组件、CSS、locale、共享实例、类型契约），element-plus 已从 package.json 卸载。
