/**
 * 存量模型引用改写（DB → 文件 id 的一次性迁移）
 *
 * ⚠️ 迁移脚手架（临时代码）：预计两个版本后随 Prisma/主库整体移除，
 * 移除清单见 docs/design/metadata-file-format.md「脚手架移除清单」。
 *
 * 模型 id 的空间在文件化重构后变了：旧值是 DB 主键（cuid），新值是
 * `{实例id}:{模型名}`。引用散落在 DB 列、settings JSON、调度任务 JSON 里，
 * 这里只做纯决策（可单测），IO 由调用方（ProviderBootstrapService）负责。
 */
import {
  SK_MOD_CHAT,
  SK_MOD_COMPRESS_MODEL,
  SK_MOD_SEARCH,
  SK_MOD_SUMMARY,
  SK_MOD_TITLE_MODEL,
  SK_MOD_TRANS_MODEL,
  SK_MOD_VISUAL,
} from '../../../constants/settings.constants';

/** models 设置组里语义为「模型引用」的键（写入时校验、迁移时改写） */
export const MODEL_ID_KEYS: ReadonlySet<string> = new Set([
  SK_MOD_CHAT,
  SK_MOD_TITLE_MODEL,
  SK_MOD_TRANS_MODEL,
  SK_MOD_COMPRESS_MODEL,
  SK_MOD_VISUAL,
  SK_MOD_SEARCH,
  SK_MOD_SUMMARY,
]);

/** 旧 model 表里需要的一行（够推导新 id 即可） */
export interface LegacyModelRow {
  id: string;
  modelName: string;
  providerId: string;
}

/**
 * 旧 id → 文件 id 映射。
 *
 * 前缀必须取 `provider_id`（实例 id，= providers/*.yaml 文件名），
 * 不能用 provider 类型键——同名模型（如 deepseek-v4-flash）会出现在多个实例下。
 */
export function buildModelIdMap(rows: LegacyModelRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row?.id || !row.modelName || !row.providerId) continue;
    map.set(row.id, `${row.providerId}:${row.modelName}`);
  }
  return map;
}

/** 单条引用的改写决策 */
export type RefRewriteOutcome =
  | { kind: 'empty' }
  | { kind: 'already-file-id' }
  | { kind: 'rewritten'; from: string; to: string }
  | { kind: 'unresolved'; from: string };

/**
 * 规划一条引用的改写。
 *
 * - 空值：不改（表示"未配置"）
 * - 已含 `:`：视为已是文件 id，不改（迁移可重复执行）
 * - 能由旧表映射且目标 id 在文件目录可解析：改写
 * - 其余（映射缺失，或映射出的模型文件已不存在）：不改，交调用方记 unresolved
 */
export function planModelRefRewrite(
  current: string | null | undefined,
  legacyToFileId: ReadonlyMap<string, string>,
  isResolvable: (fileId: string) => boolean,
): RefRewriteOutcome {
  if (current === null || current === undefined || current === '') {
    return { kind: 'empty' };
  }
  if (current.includes(':')) {
    return { kind: 'already-file-id' };
  }
  const mapped = legacyToFileId.get(current);
  if (mapped && isResolvable(mapped)) {
    return { kind: 'rewritten', from: current, to: mapped };
  }
  return { kind: 'unresolved', from: current };
}
