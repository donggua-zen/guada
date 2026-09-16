/**
 * 聊天附件子目录名的归一与校验（单一真相）。
 *
 * 该值来自用户设置，会被拼进会话工作目录路径，因此必须只接受「单层安全目录名」：
 * 挡掉路径分隔符、盘符、上跳与非法字符，避免有人靠设置把附件写到工作目录之外。
 */

import { DEFAULT_CHAT_UPLOAD_SUBDIR } from '../../constants/settings.constants';
import * as path from 'path';

/** 是否是不含路径成分的合法单层目录名 */
export function isValidChatUploadSubdir(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/[\\/]/.test(trimmed)) return false;
  if (trimmed === '.' || trimmed === '..') return false;
  if (trimmed.includes(':')) return false; // 盘符 / NTFS 数据流
  if (/[\x00-\x1f<>"|?*]/.test(trimmed)) return false;
  return true;
}

/**
 * 归一附件子目录名：空值或非法值一律回退默认值（不抛错——设置页整组保存，
 * 让一个已保存的坏值把整个 system 分组卡在错误状态里得不偿失）。
 */
export function normalizeChatUploadSubdir(raw?: string | null): string {
  const trimmed = (raw ?? '').trim();
  if (!isValidChatUploadSubdir(trimmed)) return DEFAULT_CHAT_UPLOAD_SUBDIR;
  // 额外确保归一后仍是单层（防御 path.normalize 之外的形态）
  if (path.basename(trimmed) !== trimmed) return DEFAULT_CHAT_UPLOAD_SUBDIR;
  return trimmed;
}
