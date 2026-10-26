/**
 * 访问密码强度策略（前端镜像，与 backend-ts/src/common/utils/password-strength.util.ts 同规则）。
 *
 * 账户密码比对大小写不敏感，故字符类别按「字母 / 数字 / 符号」三类计算。
 * 基础：≥8 位 + 至少 2 类；高强度（公网访问必需）：≥12 位 + 三类齐全。
 * 常见密码与包含用户名的密码判为弱。
 */

export type PasswordLevel = "weak" | "medium" | "strong";

export type PasswordErrorCode =
  | "tooShort"
  | "tooFewClasses"
  | "tooShortForPublic"
  | "tooFewClassesForPublic"
  | "common"
  | "containsUsername";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MIN_CLASSES = 2;
export const PASSWORD_STRONG_MIN_LENGTH = 12;
export const PASSWORD_STRONG_MIN_CLASSES = 3;

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

export interface PasswordStrengthResult {
  level: PasswordLevel;
  length: number;
  classes: number;
}

export function evaluatePasswordStrength(
  password: string,
  username?: string | null,
): PasswordStrengthResult {
  const value = password ?? "";
  const classes = countClasses(value);
  const lowered = value.toLowerCase();
  const name = (username ?? "").trim().toLowerCase();
  const blocked = COMMON_PASSWORDS.has(lowered) || (name.length >= 3 && lowered.includes(name));

  let level: PasswordLevel = "weak";
  if (!blocked && value.length >= PASSWORD_STRONG_MIN_LENGTH && classes >= PASSWORD_STRONG_MIN_CLASSES) {
    level = "strong";
  } else if (!blocked && value.length >= PASSWORD_MIN_LENGTH && classes >= PASSWORD_MIN_CLASSES) {
    level = "medium";
  }
  return { level, length: value.length, classes };
}

/** 返回错误码；null = 通过 */
export function getPasswordErrorCode(
  password: string,
  options: { requireStrong?: boolean; username?: string | null } = {},
): PasswordErrorCode | null {
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
