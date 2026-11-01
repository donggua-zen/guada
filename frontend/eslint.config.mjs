// ESLint 平面配置（eslint 10 + typescript-eslint 8 + eslint-plugin-vue 10）
//
// 定位：类型质量的“增量门禁”。类型正确性由 vue-tsc 全量兜底（pnpm typecheck），
// 这里负责防劣化：禁止 @ts-ignore/@ts-nocheck，显式 any 已清零并升 error。
// 首期不启用 type-aware 规则（TypeScript 6 兼容性 + 全量耗时），后续视情况再开。
import pluginVue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'

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
