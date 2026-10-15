import {
  MIN_STDIO_AGENT_VERSION,
  versionAtLeast,
  selectSshAgentTransport,
} from "./agent-version";

/**
 * agent 版本门禁：容器与 SSH(stdio) 共用。
 * - versionAtLeast：点分版本比较（位数不同按 0 补齐；空/非法按 0）
 * - selectSshAgentTransport：SSH 传输选择（≥ 0.6.0 → stdio，否则回退端口转发）
 */
describe("agent-version", () => {
  describe("versionAtLeast", () => {
    it("下限常量 = 0.6.0（stdio 首次可用版本）", () => {
      expect(MIN_STDIO_AGENT_VERSION).toBe("0.6.0");
    });

    it("相等、更高、位数不同", () => {
      expect(versionAtLeast("0.6.0", "0.6.0")).toBe(true);
      expect(versionAtLeast("0.6", "0.6.0")).toBe(true);
      expect(versionAtLeast("0.6.1", "0.6.0")).toBe(true);
      expect(versionAtLeast("1.0.0", "0.99.99")).toBe(true);
      // 10 > 9：必须按数字比较，不能按字符串比较
      expect(versionAtLeast("0.10.0", "0.9.0")).toBe(true);
      expect(versionAtLeast("0.9.0", "0.10.0")).toBe(false);
    });

    it("更低版本（含补丁位差异）判定为不满足", () => {
      expect(versionAtLeast("0.5.1", "0.6.0")).toBe(false);
      expect(versionAtLeast("0.4.10", "0.6.0")).toBe(false);
      expect(versionAtLeast("0.5.99", "0.6.0")).toBe(false);
    });

    it("空/非法版本按 0 处理（不满足下限）", () => {
      expect(versionAtLeast("", "0.6.0")).toBe(false);
      expect(versionAtLeast("NOT_FOUND", "0.6.0")).toBe(false);
      expect(versionAtLeast("abc", "0.6.0")).toBe(false);
      // 带空白/换行的输出（--version 的原始 stdout）也能解析
      expect(versionAtLeast(" 0.6.0\n", "0.6.0")).toBe(true);
    });
  });

  describe("selectSshAgentTransport", () => {
    it("≥ 0.6.0 → stdio（无需端口转发）", () => {
      expect(selectSshAgentTransport("0.6.0")).toBe("stdio");
      expect(selectSshAgentTransport("0.7.3")).toBe("stdio");
      expect(selectSshAgentTransport("1.0.0")).toBe("stdio");
    });

    it("< 0.6.0 → 端口转发回退（老环境不被破坏）", () => {
      expect(selectSshAgentTransport("0.5.1")).toBe("ws-forward");
      expect(selectSshAgentTransport("0.4.10")).toBe("ws-forward");
      expect(selectSshAgentTransport("")).toBe("ws-forward");
    });
  });
});
