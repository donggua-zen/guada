import {
  evaluatePasswordStrength,
  validatePasswordStrength,
} from "./password-strength.util";

describe("evaluatePasswordStrength", () => {
  it("短密码判为 weak", () => {
    expect(evaluatePasswordStrength("abc123").level).toBe("weak");
  });

  it("纯数字判为 weak（类别不足）", () => {
    expect(evaluatePasswordStrength("1234567890").level).toBe("weak");
  });

  it("8 位字母+数字判为 medium", () => {
    expect(evaluatePasswordStrength("abcd1234").level).toBe("weak"); // 常见密码表命中
    expect(evaluatePasswordStrength("mypass123").level).toBe("medium");
  });

  it("12 位且三类字符齐全判为 strong", () => {
    const result = evaluatePasswordStrength("MyStr0ng!Pass");
    expect(result.level).toBe("strong");
    expect(result.classes).toBe(3);
  });

  it("大小写不敏感：大写字母不额外算类别", () => {
    const result = evaluatePasswordStrength("ABCDEFGHIJKL");
    expect(result.classes).toBe(1);
    expect(result.level).toBe("weak");
  });

  it("包含用户名判为 weak", () => {
    expect(evaluatePasswordStrength("guada!Secure123", "guada").level).toBe("weak");
  });

  it("常见密码判为 weak", () => {
    expect(evaluatePasswordStrength("password123").level).toBe("weak");
  });
});

describe("validatePasswordStrength", () => {
  it("基础策略：8 位 + 2 类通过", () => {
    expect(validatePasswordStrength("mypass123")).toBeNull();
  });

  it("基础策略：过短", () => {
    expect(validatePasswordStrength("abc12")).toBe("tooShort");
  });

  it("基础策略：类别不足", () => {
    expect(validatePasswordStrength("abcdefgh")).toBe("tooFewClasses");
  });

  it("公网要求：11 位三类仍不够长", () => {
    expect(validatePasswordStrength("Abc123!@xyz", { requireStrong: true })).toBe(
      "tooShortForPublic",
    );
  });

  it("公网要求：12 位但缺少符号", () => {
    expect(validatePasswordStrength("Abcd12345678", { requireStrong: true })).toBe(
      "tooFewClassesForPublic",
    );
  });

  it("公网要求：12 位三类通过", () => {
    expect(validatePasswordStrength("Abcd1234!xyz", { requireStrong: true })).toBeNull();
  });

  it("包含用户名被拒绝（用户名长度 ≥3 时）", () => {
    expect(validatePasswordStrength("guada12345!", { username: "guada" })).toBe(
      "containsUsername",
    );
  });
});
