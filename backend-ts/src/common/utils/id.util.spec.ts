import { ID_PREFIXES, mintId, mintOrderedId } from "./id.util";
import { parseOrderedId } from "./ordered-id.util";

/**
 * 全局唯一 id 铸造入口的契约测试。
 *
 * 实体域 = <前缀>+UUID v4；消息域 = m_/c_ 有序 ULID。
 * 前缀表是全项目 id 词汇表的单一真相——形态约定破坏会连带破坏
 * 压缩遮蔽（消息域）与目录名安全（实体域），故以测试钉死。
 */
describe("id.util", () => {
  const UUID_V4_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  describe("ID_PREFIXES 前缀表", () => {
    it("全部前缀非空且以 '-' 结尾（目录/文件名安全，语义自明）", () => {
      for (const [key, prefix] of Object.entries(ID_PREFIXES)) {
        expect(prefix.length).toBeGreaterThan(0);
        expect(prefix.endsWith("-")).toBe(true);
        expect(prefix).toMatch(/^[a-z]+-$/);
        expect(key).toBeTruthy();
      }
    });

    it("既有约定键齐全（存量域零改写的前提是不漏键）", () => {
      for (const key of [
        "session",
        "agent",
        "bot",
        "mcp",
        "kb",
        "kbFile",
        "group",
        "task",
        "conn",
        "id",
      ]) {
        expect(ID_PREFIXES).toHaveProperty(key);
      }
    });
  });

  describe("mintId（实体域）", () => {
    it("前缀 + uuid v4 形态", () => {
      const id = mintId(ID_PREFIXES.session);
      expect(id.startsWith("session-")).toBe(true);
      expect(id.slice("session-".length)).toMatch(UUID_V4_SHAPE);
    });

    it("无前缀时输出裸 uuid v4（瞬时 id 用法）", () => {
      expect(mintId()).toMatch(UUID_V4_SHAPE);
    });

    it("连续铸造无碰撞", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 1000; i++) seen.add(mintId("x-"));
      expect(seen.size).toBe(1000);
    });
  });

  describe("mintOrderedId（消息域）", () => {
    it("m_ / c_ 形态可被 parseOrderedId 解析（遮蔽区间依赖）", () => {
      const m = mintOrderedId("m");
      const c = mintOrderedId("c");
      expect(parseOrderedId(m)).toEqual({ prefix: "m", ulid: m.slice(2) });
      expect(parseOrderedId(c)).toEqual({ prefix: "c", ulid: c.slice(2) });
    });

    it("检查点 'c_' 字典序恒小于 'm_'（压缩后视图排序不变量）", () => {
      for (let i = 0; i < 50; i++) {
        expect(mintOrderedId("c") < mintOrderedId("m")).toBe(true);
      }
    });

    it("同毫秒连续铸造严格递增", () => {
      let prev = mintOrderedId("m");
      for (let i = 0; i < 100; i++) {
        const next = mintOrderedId("m");
        expect(next > prev).toBe(true);
        prev = next;
      }
    });
  });
});
