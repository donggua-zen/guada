/**
 * 访问密码强度策略（v1）。
 *
 * 注意：账户密码比对是**大小写不敏感**的（AccountFileStore 会 toLowerCase 后哈希），
 * 所以大写字母不构成额外熵。字符类别按「字母 / 数字 / 符号」三类计算。
 *
 * - 基础要求（所有密码）：≥ 8 位，且至少包含 3 类中的 2 类；
 * - 高强度（公网访问开启期间设置/修改密码）：≥ 12 位，且三类字符齐全；
 * - 常见密码与包含用户名的密码一律判为弱。
 *
 * 强度只在设置/修改密码时用明文校验一次，不保存强度快照、不在运行期对存量
 * 密码做二次判断。
 */

export type PasswordStrengthLevel = "weak" | "medium" | "strong";

export interface PasswordStrengthResult {
  level: PasswordStrengthLevel;
  length: number;
  /** 有效字符类别数（字母 / 数字 / 符号，大小写不敏感） */
  classes: number;
}

export const PASSWORD_POLICY_VERSION = 1;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MIN_CLASSES = 2;
export const PASSWORD_STRONG_MIN_LENGTH = 12;
export const PASSWORD_STRONG_MIN_CLASSES = 3;

/** 小体量常见弱密码表：只拦最典型的，避免误伤与体积膨胀 */
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "88888888",
  "11111111",
  "00000000",
  "password",
  "password1",
  "password123",
  "passw0rd",
  "qwertyui",
  "qwerty123",
  "abc12345",
  "abcd1234",
  "admin123",
  "administrator",
  "iloveyou",
  "letmein123",
  "welcome123",
  "guada123",
  "guadaguada",
]);

function countClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/i.test(password)) classes += 1;
  if (/\d/.test(password)) classes += 1;
  if (/[^a-z0-9]/i.test(password)) classes += 1;
  return classes;
}

export function evaluatePasswordStrength(
  password: string,
  username?: string | null,
): PasswordStrengthResult {
  const value = password ?? "";
  const classes = countClasses(value);
  const lowered = value.toLowerCase();
  const name = (username ?? "").trim().toLowerCase();

  const isCommon = COMMON_PASSWORDS.has(lowered);
  // 用户名本身（≥3 位）不允许作为密码组成部分
  const containsUsername = name.length >= 3 && lowered.includes(name);
  const blocked = isCommon || containsUsername;

  let level: PasswordStrengthLevel = "weak";
  if (
    !blocked &&
    value.length >= PASSWORD_STRONG_MIN_LENGTH &&
    classes >= PASSWORD_STRONG_MIN_CLASSES
  ) {
    level = "strong";
  } else if (!blocked && value.length >= PASSWORD_MIN_LENGTH && classes >= PASSWORD_MIN_CLASSES) {
    level = "medium";
  }

  return { level, length: value.length, classes };
}

export type PasswordValidationErrorCode =
  | "tooShort"
  | "tooFewClasses"
  | "tooShortForPublic"
  | "tooFewClassesForPublic"
  | "common"
  | "containsUsername";

export interface PasswordValidationOptions {
  /** 公网访问场景要求高强度密码 */
  requireStrong?: boolean;
  username?: string | null;
}

/**
 * 校验密码强度，返回错误码（null = 通过）。
 * 文案由调用方决定（后端返回中文提示，前端走 i18n）。
 */
export function validatePasswordStrength(
  password: string,
  options: PasswordValidationOptions = {},
): PasswordValidationErrorCode | null {
  const value = password ?? "";
  const classes = countClasses(value);
  const username = (options.username ?? "").trim().toLowerCase();
  const lowered = value.toLowerCase();

  if (COMMON_PASSWORDS.has(lowered)) return "common";
  if (username.length >= 3 && lowered.includes(username)) return "containsUsername";

  if (options.requireStrong) {
    if (value.length < PASSWORD_STRONG_MIN_LENGTH) return "tooShortForPublic";
    if (classes < PASSWORD_STRONG_MIN_CLASSES) return "tooFewClassesForPublic";
    return null;
  }

  if (value.length < PASSWORD_MIN_LENGTH) return "tooShort";
  if (classes < PASSWORD_MIN_CLASSES) return "tooFewClasses";
  return null;
}

/** 后端错误提示（与前端 i18n 文案保持同义） */
export const PASSWORD_VALIDATION_MESSAGES: Record<PasswordValidationErrorCode, string> = {
  tooShort: `密码长度至少 ${PASSWORD_MIN_LENGTH} 位`,
  tooFewClasses: "密码需包含字母、数字、符号中的至少 2 类",
  tooShortForPublic: `公网访问要求密码长度至少 ${PASSWORD_STRONG_MIN_LENGTH} 位`,
  tooFewClassesForPublic: "公网访问要求密码同时包含字母、数字、符号",
  common: "该密码过于常见，请更换更复杂的密码",
  containsUsername: "密码不能包含用户名",
};
