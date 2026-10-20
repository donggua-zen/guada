/**
 * 分组/项目自定义图标 key 的输入解析。
 *
 * 图标是前端白名单里的语义 key（如 `code` / `rocket`），后端不感知具体
 * Fluent 组件名：这里只校验字符集与长度，未知 key 由前端回退默认文件夹。
 * 这样新增图标只需改前端注册表，不必同步后端。
 */

/** 合法图标 key：小写字母、数字、连字符，1-32 位 */
export const GROUP_ICON_KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

export interface ParsedGroupIcon {
  /** undefined = 调用方未提供该字段（保持原值）；null = 清除为默认图标 */
  value?: string | null;
  /** 提供了但格式非法 */
  invalid: boolean;
}

export function parseGroupIcon(
  icon: string | null | undefined,
): ParsedGroupIcon {
  if (icon === undefined) return { invalid: false };
  if (icon === null) return { value: null, invalid: false };
  const trimmed = icon.trim();
  // 空串视同清除，避免前端清空输入时被当成非法值
  if (!trimmed) return { value: null, invalid: false };
  if (!GROUP_ICON_KEY_PATTERN.test(trimmed)) return { invalid: true };
  return { value: trimmed, invalid: false };
}
