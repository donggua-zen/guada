/**
 * 模型引用写入边界校验
 *
 * 模型/供应商的权威来源是 providers/*.yaml，模型 id 形如 `{实例id}:{模型名}`。
 * 任何把模型引用写进持久化的入口都应先过这里：坏引用一旦落库，运行期只能
 * fail-loud 报错，救不回数据。
 */
import { BadRequestException } from '@nestjs/common';
import type { ProviderFileStore } from '../provider-file.store';

/**
 * 断言模型引用可解析；空值放行（表示"不改动该字段"）。
 * @throws BadRequestException 引用无法从文件目录解析时
 */
export function assertResolvableModelRef(
  store: ProviderFileStore,
  modelId: string | null | undefined,
  fieldLabel: string,
): void {
  if (modelId === null || modelId === undefined || modelId === '') return;
  if (store.findModel(modelId)) return;
  throw new BadRequestException(
    `无效的模型引用（${fieldLabel}）：${modelId}。` +
      `该模型可能已被删除或改名，请从模型列表重新选择。`,
  );
}
