// ESLint 平面配置（eslint 10 + typescript-eslint 8 + eslint-plugin-vue 10）
//
// 定位：类型质量的“增量门禁”。类型正确性由 vue-tsc 全量兜底（pnpm typecheck），
// 这里负责防劣化：禁止新增 @ts-ignore/@ts-nocheck，新增显式 any 以 warn 基线化。
// 首期不启用 type-aware 规则（TypeScript 6 兼容性 + 全量耗时），后续视情况再开。
import pluginVue from 'eslint-plugin-vue'
import ts from 'typescript-eslint'

/** 类型质量核心规则（.ts 与 .vue 的 <script lang="ts"> 同一口径） */
const typeQualityRules = {
  // 存量显式 any 较多（历史欠账）：warn 基线化，只防增量、不清旧账；清零后升 error
  '@typescript-eslint/no-explicit-any': 'warn',
  // P0 已清零全部压制注释：从现在起不允许再新增
  '@typescript-eslint/ban-ts-comment': 'error',
  // 未使用变量由 tsconfig noUnusedLocals 统一接管（P3 开启），避免双份口径
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

  // 现存单词组件名（Login.vue、Queue.vue 等）为既定命名，不强制多词
  { rules: { 'vue/multi-word-component-names': 'off' } },
)
