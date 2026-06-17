/**
 * 文件处理进度回调
 * 用于在文件处理管线中逐层传递进度更新
 */
export type FileProgressCallback = (
  percentage: number,
  currentStep: string,
) => Promise<void>;

/**
 * 合并两个进度回调，使两个回调都被调用
 */
export function combineCallbacks(
  ...callbacks: (FileProgressCallback | undefined)[]
): FileProgressCallback | undefined {
  const valid = callbacks.filter((c): c is FileProgressCallback => c !== undefined);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return async (percentage, currentStep) => {
    await Promise.all(valid.map((cb) => cb(percentage, currentStep)));
  };
}
