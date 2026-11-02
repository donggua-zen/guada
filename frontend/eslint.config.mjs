// ESLint 平面配置（eslint 10 + typescript-eslint 8 + eslint-plugin-vue 10）
//
// 定位：类型质量的“增量门禁”。类型正确性由 vue-tsc 全量兜底（pnpm typecheck），
// 这里负责防劣化：禁止 @ts-ignore/@ts-nocheck，显式 any 已清零并升 error。
// 首期不启用 type-aware 规则（TypeScript 6 兼容性 + 全量耗时），后续视情况再开。
import pluginVue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'
import globals from 'globals'

/** 类型质量核心规则（.ts 与 .vue 的 <script lang="ts"> 同一口径） */
const typeQualityRules = {
  // 生产代码显式 any 已清零（2026-10 类型债务清偿）：动态边界逐处
  // eslint-disable-next-line 豁免（带白名单说明），其余一律 error
  '@typescript-eslint/no-explicit-any': 'error',
  // P0 已清零全部压制注释：从现在起不允许再新增
  '@typescript-eslint/ban-ts-comment': 'error',
  // 未使用变量由 tsconfig noUnusedLocals 统一接管，避免双份口径
  '@typescript-eslint/no-unused-vars': 'off',
}

export default ts.config(
  // 生成物与产物不参与 lint
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'src/types/auto-imports.d.ts',
      'src/types/components.d.ts',
    ],
  },

  // TS 推荐规则（不含 eslint:recommended：no-undef 由 TS 负责，
  // unplugin-auto-import 的全局 ref/computed 不能靠 no-undef 判定）
  ...ts.configs.recommended,

  // Vue essential：只收正确性规则；strongly-recommended 的风格类规则会造成
  // 海量无关 diff，待存量消化后单独再开
  ...pluginVue.configs['flat/essential'],

  // <script lang="ts"> 交给 typescript-eslint 解析并套用同一组类型质量规则
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] },
    },
    plugins: { '@typescript-eslint': ts.plugin },
    rules: typeQualityRules,
  },

  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: typeQualityRules,
  },

  // 测试文件：夹具（fixture）模拟后端脏数据形态，显式 any 是诚实的；类型正确性仍由 vue-tsc 覆盖
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // 第三方 ambient 声明（partial-json 无类型包、插件运行时契约）：镜像外部 any 形态
  {
    files: ['src/types/partial-json.d.ts', 'src/types/plugin-runtime.d.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // 现存单词组件名（Login.vue、Queue.vue 等）为既定命名，不强制多词
  { rules: { 'vue/multi-word-component-names': 'off' } },

  // 未定义变量兜底（2026-11 增加）：vue-tsc 不检查 <script setup>（无 lang="ts"）的
  // 文件与 src 下 3 个 .js 文件（main.js / plugin-loader.js / usePluginI18n.js），
  // "import 被迁移脚本吃掉"这类损伤曾在那里静默存活（MCPServers 的 usePopup）。
  // no-undef 对 lang="ts" 文件同样生效，但 TS 类型引用不进入 ESLint 的作用域分析，
  // 不会误报；浏览器全局走 globals 表，Electron ambient 接口单独登记。
  // auto-imports.d.ts 只声明 ElMessage/ElNotification（均已禁用），
  // 若有 bare 调用残留，正好由 no-undef 揪出，不登记。
  {
    files: ['**/*.vue', 'src/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        // src/vite-env.d.ts 的 ambient 接口（模板事件 as 断言用）
        ElectronWebviewElement: 'readonly',
        ElectronWebviewNavigateEvent: 'readonly',
        ElectronWebviewTitleUpdatedEvent: 'readonly',
      },
    },
    rules: { 'no-undef': 'error' },
  },

  // 路由哨兵字面量防劣化：'new-session' 只允许定义在 src/constants（NEW_SESSION_ID）。
  // 散落字面量容易再出现"把它当会话 id 去打后端接口"的旧问题（workspace-path 500 +
  // 存储层懒创建出幽灵会话目录，见 session-path.util.ts 的 RESERVED_IDS）
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.vue', '**/*.js'],
    ignores: ['src/constants/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='new-session']",
          message: '改用 @/constants 的 NEW_SESSION_ID（路由哨兵不是会话 id，不能拿它去调后端接口）',
        },
      ],
    },
  },
  // 组件标签防回归：模板元素限制用 vue/no-restricted-html-elements。
  // 不用 no-restricted-syntax 的 VElement selector——核心规则不遍历模板节点，写了也不生效。
  {
    files: ['**/*.vue'],
    rules: {
      'vue/no-restricted-html-elements': [
        'error',
        { element: 'el-dialog', message: '弹窗统一使用 GdDialog；不要在模板里直接写 <el-dialog>。' },
        { element: 'ElDialog', message: '弹窗统一使用 GdDialog；不要在模板里直接写 <ElDialog>。' },
        { element: 'el-button', message: '按钮统一使用 GdButton；不要在模板里直接写 <el-button>。' },
        { element: 'ElButton', message: '按钮统一使用 GdButton；不要在模板里直接写 <ElButton>。' },
        { element: 'el-input', message: '输入框统一使用 GdInput（@/components/ui/GdInput.vue）；不要在模板里直接写 <el-input>。' },
        { element: 'ElInput', message: '输入框统一使用 GdInput；不要在模板里直接写 <ElInput>。' },
        { element: 'el-switch', message: '开关统一使用 GdSwitch（@/components/ui/GdSwitch.vue）；不要在模板里直接写 <el-switch>。' },
        { element: 'ElSwitch', message: '开关统一使用 GdSwitch；不要在模板里直接写 <ElSwitch>。' },
        { element: 'el-select', message: '下拉选择统一使用 GdSelect（@/components/ui/GdSelect.vue）+ GdOption；不要在模板里直接写 <el-select>。' },
        { element: 'ElSelect', message: '下拉选择统一使用 GdSelect + GdOption；不要在模板里直接写 <ElSelect>。' },
        { element: 'el-option', message: '下拉选项统一使用 GdOption（@/components/ui/GdSelectOption）；不要在模板里直接写 <el-option>。' },
        { element: 'ElOption', message: '下拉选项统一使用 GdOption；不要在模板里直接写 <ElOption>。' },
        { element: 'el-dropdown', message: '下拉菜单统一使用 DropdownMenu / DropdownMenuItem（@/components/ui/）；不要在模板里直接写 <el-dropdown>。' },
        { element: 'ElDropdown', message: '下拉菜单统一使用 DropdownMenu / DropdownMenuItem；不要在模板里直接写 <ElDropdown>。' },
        { element: 'el-dropdown-menu', message: '下拉菜单统一使用 DropdownMenu / DropdownMenuItem；不要在模板里直接写 <el-dropdown-menu>。' },
        { element: 'ElDropdownMenu', message: '下拉菜单统一使用 DropdownMenu / DropdownMenuItem；不要在模板里直接写 <ElDropdownMenu>。' },
        { element: 'el-dropdown-item', message: '下拉菜单统一使用 DropdownMenu / DropdownMenuItem；不要在模板里直接写 <el-dropdown-item>。' },
        { element: 'ElDropdownItem', message: '下拉菜单统一使用 DropdownMenu / DropdownMenuItem；不要在模板里直接写 <ElDropdownItem>。' },
        { element: 'el-input-number', message: '数字输入统一使用 GdInputNumber（@/components/ui/GdInputNumber.vue）；不要在模板里直接写 <el-input-number>。' },
        { element: 'ElInputNumber', message: '数字输入统一使用 GdInputNumber；不要在模板里直接写 <ElInputNumber>。' },
        { element: 'el-slider', message: '滑块统一使用 GdSlider（@/components/ui/GdSlider.vue）；不要在模板里直接写 <el-slider>。' },
        { element: 'ElSlider', message: '滑块统一使用 GdSlider；不要在模板里直接写 <ElSlider>。' },
        { element: 'el-tag', message: '标签统一使用 GdTag（@/components/ui/GdTag.vue）；不要在模板里直接写 <el-tag>。' },
        { element: 'ElTag', message: '标签统一使用 GdTag；不要在模板里直接写 <ElTag>。' },
        { element: 'el-alert', message: '提示条统一使用 GdAlert（@/components/ui/GdAlert.vue）；不要在模板里直接写 <el-alert>。' },
        { element: 'ElAlert', message: '提示条统一使用 GdAlert；不要在模板里直接写 <ElAlert>。' },
        { element: 'el-divider', message: '分隔线统一使用 GdDivider（@/components/ui/GdDivider.vue）；不要在模板里直接写 <el-divider>。' },
        { element: 'ElDivider', message: '分隔线统一使用 GdDivider；不要在模板里直接写 <ElDivider>。' },
        { element: 'el-progress', message: '进度条统一使用 GdProgress（@/components/ui/GdProgress.vue）；不要在模板里直接写 <el-progress>。' },
        { element: 'ElProgress', message: '进度条统一使用 GdProgress；不要在模板里直接写 <ElProgress>。' },
        { element: 'el-empty', message: '空态统一使用 GdEmpty（@/components/ui/GdEmpty.vue）；不要在模板里直接写 <el-empty>。' },
        { element: 'ElEmpty', message: '空态统一使用 GdEmpty；不要在模板里直接写 <ElEmpty>。' },
        { element: 'el-badge', message: '徽标已去组件化：直接用 span 数字气泡（参考 KBFileUploader）；不要在模板里直接写 <el-badge>。' },
        { element: 'ElBadge', message: '徽标已去组件化：直接用 span 数字气泡；不要在模板里直接写 <ElBadge>。' },
        { element: 'el-link', message: '链接语义用 GdButton link；不要在模板里直接写 <el-link>。' },
        { element: 'ElLink', message: '链接语义用 GdButton link；不要在模板里直接写 <ElLink>。' },
        { element: 'el-icon', message: '图标直接用 @vicons/fluent 裸组件 + Tailwind 尺寸类（size-4 / w-4 h-4），不包 el-icon；旋转用 animate-spin。' },
        { element: 'ElIcon', message: '图标直接用 @vicons/fluent 裸组件 + Tailwind 尺寸类，不包 ElIcon。' },
        { element: 'el-form', message: '表单布局统一用 GdFormField（@/components/ui/GdFormField.vue），校验用 useFormValidation composable；不要在模板里直接写 <el-form>。' },
        { element: 'ElForm', message: '表单布局统一用 GdFormField + useFormValidation；不要在模板里直接写 <ElForm>。' },
        { element: 'el-form-item', message: '表单字段统一用 GdFormField（label + 控件 + 行内红字）；不要在模板里直接写 <el-form-item>。' },
        { element: 'ElFormItem', message: '表单字段统一用 GdFormField；不要在模板里直接写 <ElFormItem>。' },
        { element: 'el-checkbox', message: '勾选框统一使用 GdCheckbox / GdCheckboxGroup（@/components/ui/）；不要在模板里直接写 <el-checkbox>。' },
        { element: 'ElCheckbox', message: '勾选框统一使用 GdCheckbox / GdCheckboxGroup；不要在模板里直接写 <ElCheckbox>。' },
        { element: 'el-checkbox-group', message: '勾选组统一使用 GdCheckboxGroup；不要在模板里直接写 <el-checkbox-group>。' },
        { element: 'ElCheckboxGroup', message: '勾选组统一使用 GdCheckboxGroup；不要在模板里直接写 <ElCheckboxGroup>。' },
        { element: 'el-checkbox-button', message: '勾选按钮组统一使用 GdCheckboxGroup + GdCheckbox；不要在模板里直接写 <el-checkbox-button>。' },
        { element: 'ElCheckboxButton', message: '勾选按钮组统一使用 GdCheckboxGroup + GdCheckbox；不要在模板里直接写 <ElCheckboxButton>。' },
        { element: 'el-radio', message: '单选统一使用 GdRadio / GdRadioGroup 或 GdSegmented（@/components/ui/）；不要在模板里直接写 <el-radio>。' },
        { element: 'ElRadio', message: '单选统一使用 GdRadio / GdRadioGroup 或 GdSegmented；不要在模板里直接写 <ElRadio>。' },
        { element: 'el-radio-group', message: '单选组统一使用 GdRadioGroup 或 GdSegmented；不要在模板里直接写 <el-radio-group>。' },
        { element: 'ElRadioGroup', message: '单选组统一使用 GdRadioGroup 或 GdSegmented；不要在模板里直接写 <ElRadioGroup>。' },
        { element: 'el-radio-button', message: '分段单选统一使用 GdSegmented；不要在模板里直接写 <el-radio-button>。' },
        { element: 'ElRadioButton', message: '分段单选统一使用 GdSegmented；不要在模板里直接写 <ElRadioButton>。' },
        { element: 'el-tabs', message: '页签统一使用 GdTabs（@/components/ui/GdTabs.vue）；不要在模板里直接写 <el-tabs>。' },
        { element: 'ElTabs', message: '页签统一使用 GdTabs；不要在模板里直接写 <ElTabs>。' },
        { element: 'el-tab-pane', message: '页签统一使用 GdTabs（tabs 数组 + 外部 v-if 渲染内容）；不要在模板里直接写 <el-tab-pane>。' },
        { element: 'ElTabPane', message: '页签统一使用 GdTabs；不要在模板里直接写 <ElTabPane>。' },
        { element: 'el-pagination', message: '分页统一使用 GdPagination（@/components/ui/GdPagination.vue）；不要在模板里直接写 <el-pagination>。' },
        { element: 'ElPagination', message: '分页统一使用 GdPagination；不要在模板里直接写 <ElPagination>。' },
        { element: 'el-collapse', message: '折叠面板统一使用 GdCollapse（@/components/ui/GdCollapse.vue）；不要在模板里直接写 <el-collapse>。' },
        { element: 'ElCollapse', message: '折叠面板统一使用 GdCollapse；不要在模板里直接写 <ElCollapse>。' },
        { element: 'el-collapse-item', message: '折叠面板统一使用 GdCollapse；不要在模板里直接写 <el-collapse-item>。' },
        { element: 'ElCollapseItem', message: '折叠面板统一使用 GdCollapse；不要在模板里直接写 <ElCollapseItem>。' },
        { element: 'el-upload', message: '上传已去组件化：自绘拖放/点击区 + 隐藏 input[type=file]（参考 Skills.vue）；不要在模板里直接写 <el-upload>。' },
        { element: 'ElUpload', message: '上传已去组件化：自绘拖放/点击区 + 隐藏 input[type=file]；不要在模板里直接写 <ElUpload>。' },
        { element: 'el-image-viewer', message: '图片预览统一使用 GdImageViewer（@/components/ui/GdImageViewer.vue）；不要在模板里直接写 <el-image-viewer>。' },
        { element: 'ElImageViewer', message: '图片预览统一使用 GdImageViewer；不要在模板里直接写 <ElImageViewer>。' },
        { element: 'el-drawer', message: '抽屉统一使用 GdDrawer（@/components/ui/GdDrawer.vue）；不要在模板里直接写 <el-drawer>。' },
        { element: 'ElDrawer', message: '抽屉统一使用 GdDrawer；不要在模板里直接写 <ElDrawer>。' },
        { element: 'el-table', message: '表格已去组件化：静态对比数据用原生 <table> + Tailwind/局部样式（参考 SplitpanesPerfTest.vue）；不要在模板里直接写 <el-table>。' },
        { element: 'ElTable', message: '表格已去组件化：静态数据用原生 <table>；不要在模板里直接写 <ElTable>。' },
        { element: 'el-table-column', message: '表格已去组件化：静态数据用原生 <table>；不要在模板里直接写 <el-table-column>。' },
        { element: 'ElTableColumn', message: '表格已去组件化：静态数据用原生 <table>；不要在模板里直接写 <ElTableColumn>。' },
        { element: 'el-date-picker', message: '日期时间选择统一使用 GdDatePicker（@/components/ui/GdDatePicker.vue）；不要在模板里直接写 <el-date-picker>。' },
        { element: 'ElDatePicker', message: '日期时间选择统一使用 GdDatePicker；不要在模板里直接写 <ElDatePicker>。' },
        { element: 'el-time-picker', message: '时间选择统一使用 GdTimePicker（@/components/ui/GdTimePicker.vue）；不要在模板里直接写 <el-time-picker>。' },
        { element: 'ElTimePicker', message: '时间选择统一使用 GdTimePicker；不要在模板里直接写 <ElTimePicker>。' },
        { element: 'el-tree', message: '只读展示树统一使用 GdTree（@/components/ui/GdTree.vue）；不要在模板里直接写 <el-tree>。' },
        { element: 'ElTree', message: '只读展示树统一使用 GdTree；不要在模板里直接写 <ElTree>。' },
        { element: 'el-config-provider', message: 'element-plus 已整体卸载，不要引入任何 Element Plus 组件。' },
        { element: 'ElConfigProvider', message: 'element-plus 已整体卸载，不要引入任何 Element Plus 组件。' },
      ],
    },
  },
  // 弹窗体系防回归：模态框统一走 GdDialog；命令式确认/输入统一走 usePopup（内部委托
  // modalService + GdDialogHost）。Element 仅保留表单控件、轻提示与日志抽屉。
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.vue', '**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'element-plus',
              importNames: ['ElMessageBox', 'ElDialog'],
              message: '弹窗统一使用 GdDialog / usePopup（modalService），不要直接使用 Element Plus 的 ElMessageBox / ElDialog。',
            },
            {
              name: 'element-plus',
              importNames: ['ElButton'],
              message: '按钮统一使用 GdButton（@/components/ui/GdButton.vue），不要使用 Element Plus 的 ElButton。',
            },
            {
              name: 'element-plus',
              importNames: ['ElInput'],
              message: '输入框统一使用 GdInput（@/components/ui/GdInput.vue），不要使用 Element Plus 的 ElInput。',
            },
            {
              name: 'element-plus',
              importNames: ['ElSwitch'],
              message: '开关统一使用 GdSwitch（@/components/ui/GdSwitch.vue），不要使用 Element Plus 的 ElSwitch。',
            },
            {
              name: 'element-plus',
              importNames: ['ElSelect', 'ElOption'],
              message: '下拉选择统一使用 GdSelect + GdOption（@/components/ui/），不要使用 Element Plus 的 ElSelect / ElOption。',
            },
            {
              name: 'element-plus',
              importNames: ['ElDropdown', 'ElDropdownMenu', 'ElDropdownItem'],
              message: '下拉菜单统一使用 DropdownMenu / DropdownMenuItem（@/components/ui/），不要使用 Element Plus 的 ElDropdown 系列。',
            },
            {
              name: 'element-plus',
              importNames: ['ElInputNumber'],
              message: '数字输入统一使用 GdInputNumber（@/components/ui/GdInputNumber.vue），不要使用 Element Plus 的 ElInputNumber。',
            },
            {
              name: 'element-plus',
              importNames: ['ElSlider'],
              message: '滑块统一使用 GdSlider（@/components/ui/GdSlider.vue），不要使用 Element Plus 的 ElSlider。',
            },
            {
              name: 'element-plus',
              importNames: ['ElTag', 'ElAlert', 'ElDivider', 'ElProgress', 'ElEmpty', 'ElBadge', 'ElLink'],
              message: '标签/提示条/分隔线/进度条/空态统一使用 GdTag/GdAlert/GdDivider/GdProgress/GdEmpty（@/components/ui/），徽标用 span、链接用 GdButton link；不要使用 Element Plus 的这批组件。',
            },
            {
              name: 'element-plus',
              importNames: ['ElIcon'],
              message: '图标直接用 @vicons/fluent 裸组件（Tailwind 尺寸类控制大小），不要使用 Element Plus 的 ElIcon 容器。',
            },
            {
              name: 'element-plus',
              importNames: ['ElForm', 'ElFormItem', 'ElCheckbox', 'ElCheckboxGroup', 'ElCheckboxButton', 'ElRadio', 'ElRadioGroup', 'ElRadioButton'],
              message: '表单布局用 GdFormField + useFormValidation；勾选用 GdCheckbox(Group)；单选用 GdSegmented / GdRadio(Group)。不要使用 Element Plus 的这批组件。',
            },
            {
              name: 'element-plus',
              importNames: ['ElTabs', 'ElTabPane', 'ElPagination', 'ElCollapse', 'ElCollapseItem', 'ElUpload'],
              message: '页签用 GdTabs、分页用 GdPagination、折叠用 GdCollapse、上传去组件化（自绘容器 + 隐藏 input）。不要使用 Element Plus 的这批组件。',
            },
            {
              name: 'element-plus',
              importNames: ['ElImageViewer', 'ElDrawer', 'ElTable', 'ElTableColumn'],
              message: '图片预览用 GdImageViewer、抽屉用 GdDrawer（@/components/ui/）、静态表格用原生 <table>。不要使用 Element Plus 的这批组件。',
            },
            {
              name: 'element-plus',
              importNames: ['ElDatePicker', 'ElTimePicker'],
              message: '日期时间选择用 GdDatePicker、时间选择用 GdTimePicker（@/components/ui/）。不要使用 Element Plus 的这批组件。',
            },
            {
              name: 'element-plus',
              message: 'element-plus 已于 2026-11 整体卸载（去 Element 化收官），不要以任何形式再引入：UI 一律使用 Gd* 组件（@/components/ui/）。',
            },
            {
              name: 'element-plus',
              importNames: ['ElMessage', 'ElNotification', 'ElLoading', 'ElLoadingDirective'],
              message: '轻提示统一使用 GdToast（@/components/ui/toastService，组件内也可用 usePopup().toast/notify），不要使用 Element Plus 的 ElMessage / ElNotification / ElLoading。',
            },
            {
              name: '@element-plus/icons-vue',
              message:
                '图标统一使用 @vicons/fluent（自定义图标放 @/components/icons）。Element Plus 图标已于 2026-10 全量迁移，勿再引入。',
            },
            {
              name: '@vicons/antd',
              message: '图标统一使用 @vicons/fluent。Ant Design 图标已于 2026-10 全量迁移，勿再引入。',
            },
            {
              name: '@vicons/ionicons5',
              message: '图标统一使用 @vicons/fluent。Ionicons 图标已于 2026-10 全量迁移，勿再引入。',
            },
          ],
        },
      ],
    },
  },
)
