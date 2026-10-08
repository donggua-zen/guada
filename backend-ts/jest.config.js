module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json'
    }],
    // 纯 ESM 依赖（@marcbachmann/cel-js）经 ts-jest 转 CJS 进 jest 沙箱：
    // jest 的模块系统会拦截 createRequire(esm)，只有让 jest 自己转译才能同步加载。
    // 例外：随包分发的插件入口是纯 CJS（plugins/guada-themes/index.js），
    // 生产由 Node 直接 require，jest 里也按原生 CJS 加载即可（避免 allowJs 告警）。
    '^(?!.*plugins[\\\\/]guada-themes).+\\.js$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        module: 'commonjs',
        target: 'ES2022',
        isolatedModules: true,
        skipLibCheck: true,
        esModuleInterop: true,
      },
    }],
  },
  // 默认不转译 node_modules；仅放行 cel-js（ESM-only，需转 CJS 才能在 jest 里 require）。
  // pnpm 嵌套布局：路径形如 node_modules/.pnpm/.../node_modules/@marcbachmann/cel-js/...，
  // 负向断言需让任意 node_modules/ 段之后只要出现 @marcbachmann 就不算命中。
  transformIgnorePatterns: ['node_modules/(?!.*@marcbachmann)'],
  moduleNameMapper: {
    '^uuid$': '<rootDir>/test/__mocks__/uuid.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.interface.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.entity.ts',
  ],
};
