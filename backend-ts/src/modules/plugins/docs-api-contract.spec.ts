import * as fs from "fs";
import * as path from "path";
import { PluginApiImpl } from "./api/plugin-api";
import { PLUGIN_API_VERSION } from "./types/plugin.types";

/**
 * 文档 ↔ 实现 契约一致性
 *
 * 背景：`docs/plugin-api.md` 是三方插件开发的唯一权威入口。历史上文档版本
 * 长期落后实现（文档写 v2、实际 v4；`entries` 写了却不生效；64 个方法只登记 9 个），
 * 导致每次写插件都要重新读源码梳理。
 *
 * 本测试把「文档声明的 API 集合」与「实现实际暴露的方法」绑在一起：
 * 新增/删除 PluginApi 方法而没同步文档时，这里会失败。
 *
 * 注意：只校验**方法名集合**与版本号这类可机械比对的部分，
 * 不校验散文描述（那需要人读）。
 */

// 文件位于 backend-ts/src/modules/plugins/，文档在仓库根 docs/
const DOC_PATH = path.resolve(__dirname, "../../../../docs/plugin-api.md");

function readDoc(): string {
  return fs.readFileSync(DOC_PATH, "utf8");
}

/** 从文档中提取用反引号标注的方法名（`registerTool(...)` 形式） */
function methodsDeclaredInDoc(doc: string): Set<string> {
  const found = new Set<string>();
  // 匹配 `name(` 或 `name()` 形式的反引号代码片段
  const re = /`([a-z][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    found.add(m[1]);
  }
  return found;
}

/** 实现侧实际暴露的公开方法（原型上的自有可调用成员，排除下划线与内部方法） */
function methodsImplementedInApi(): Set<string> {
  const names = new Set<string>();
  const proto = PluginApiImpl.prototype as any;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    if (name.startsWith("_") || name.startsWith("setJob")) continue;
    // 内部 flush / 装配期辅助方法不算公开契约
    if (
      [
        "flush",
        "commitPluginSkill",
        "getCommandProviders",
        "getWorkspaceProviders",
        "getPromptSections",
        "getPromptTransforms",
        "getLocalCommands",
        "getHooks",
        "getSkins",
        "getAgentDefs",
        "getAttachmentTypes",
        "getUiPages",
        "getSlots",
        "getRpcHandlers",
        "getProviderContributions",
      ].includes(name)
    ) {
      continue;
    }
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (desc && typeof desc.value === "function") names.add(name);
  }
  return names;
}

describe("docs/plugin-api.md ↔ PluginApi 契约一致性", () => {
  it("文档存在且声明了正确的 API 版本", () => {
    expect(fs.existsSync(DOC_PATH)).toBe(true);
    const doc = readDoc();
    expect(doc).toContain(`PLUGIN_API_VERSION = ${PLUGIN_API_VERSION}`);
    // 防止文档标题版本落后于实现（历史问题：文档写 v2、实现是 v4）
    expect(doc).toContain(`PluginApi v${PLUGIN_API_VERSION}`);
  });

  it("实现里的每个公开方法都在文档中登记", () => {
    const doc = readDoc();
    const declared = methodsDeclaredInDoc(doc);
    const implemented = methodsImplementedInApi();

    const missing = [...implemented].filter((name) => !declared.has(name)).sort();

    expect({
      missingInDoc: missing,
      hint: "有新的 PluginApi 方法没写进 docs/plugin-api.md",
    }).toEqual({ missingInDoc: [], hint: expect.any(String) });
  });

  it("文档登记的方法在实现中都存在（防写入不存在的能力）", () => {
    const doc = readDoc();
    const declared = methodsDeclaredInDoc(doc);
    const implemented = methodsImplementedInApi();

    // 文档里可能出现的是 toolkit 句柄方法（不在 PluginApi 上）或历史别名，
    // 这些允许存在但不校验；只校验看起来像 PluginApi 主干的 register*/get*/set*/delete* 前缀
    const looksLikeApi = (name: string) =>
      /^(register|complete|listModels|startJob|getData|setValue|deleteValue|getPluginDir|getDataDir|getApiVersion)/.test(
        name,
      ) && name !== "registerTool" /* 由工具包句柄覆盖，另见下一条 */;

    const phantom = [...declared]
      .filter((name) => looksLikeApi(name) && !implemented.has(name))
      .sort();

    expect({
      phantom: phantom,
      hint: "docs/plugin-api.md 写了实现里不存在的 API",
    }).toEqual({ phantom: [], hint: expect.any(String) });
  });

  it("文档必须记录仍存在的陷阱，并标记已修复项", () => {
    const doc = readDoc();

    // 仍然存在的坑：删掉会导致读者再次踩中
    expect(doc).toMatch(/工具重名无仲裁/);
    expect(doc).toMatch(/插件无沙箱|同进程/);
    expect(doc).toMatch(/Zod `\.default\(\)` 会进 `required`/);

    // 已修复项必须保留「已修复」标记，避免读者按旧经验写代码
    expect(doc).toMatch(/### 7\.1 已修复/);
    expect(doc).toMatch(/entries` 字段无效[\s\S]{0,80}已支持/);
    expect(doc).toMatch(/本地命令不跟随启停[\s\S]{0,80}已修复/);
  });
});
