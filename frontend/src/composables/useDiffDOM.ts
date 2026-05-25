import { DiffDOM } from 'diff-dom';

// 模块级单例，整个应用共享同一个 DiffDOM 实例
let globalDiffEngine: DiffDOM | null = null;

/**
 * 获取全局共享的 DiffDOM 单例实例
 * @returns DiffDOM 实例
 */
export function useDiffDOM(): DiffDOM {
  if (!globalDiffEngine) {
    globalDiffEngine = new DiffDOM({
      debug: true,
      valueDiffing: true,
    });
    console.log('[DiffDOM] 全局单例初始化（仅一次）');
  }
  return globalDiffEngine;
}
