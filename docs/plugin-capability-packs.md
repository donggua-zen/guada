# 能力包（Capability Packs）：工具包 + 工具 + 提示词 + 技能

> PluginApi v4.1 起，工具包升级为「能力包」：除工具与提示词外，还可以注册技能。
> 技能随能力包的启停与加载模式自动显隐——智能体禁用该包、handler 返回
> `loadMode:"none"`、子代理会话等场景下，技能与工具同步消失。

## 动机

v4 之前，"工具 + 长文档"需要插件用 `api.registerSkill` 手动配对，而技能的生命周期
与工具包完全独立：

- 智能体禁用了工具包，技能仍出现在 `# Skills` 清单里、`skill_learn` 仍可读取；
- 工具包 handler 按会话返回 `none`（如子代理会话禁止递归），技能不跟随；
- 插件作者要自己维护 pair 与清理逻辑。

能力包把技能纳入工具包的注册与门控：**技能是工具包的一项贡献**，跟随它的运行时可见性。

## 用法

```ts
async onLoad(api: PluginApi) {
  const kit = api.registerToolKit({
    id: "workflow",
    name: "工作流",
    loadMode: "eager",        // 或 "lazy"（见下）
    handler: (ctx) =>
      ctx.session.sessionType === "sub_agent"
        ? { loadMode: "none" }  // 该会话整包不可用：工具 + 技能 + 提示词一起消失
        : { loadMode: "eager" },
  });

  kit.registerTool({ name: "workflow_run", description: "…", inputSchema: z.object({…}), execute: … });

  // 技能随能力包门控：智能体禁用 workflow 包 / handler 返回 none 时同步隐藏
  kit.registerSkill({
    name: "workflow",
    description: "Required reading before calling workflow_run: …",
    content: SKILL_MARKDOWN,
    version: "1.0.0",
    tags: ["workflow"],
    // visibleTo 省略时继承 kit 的 visibleTo（限定智能体可见的包，其技能同样限定）
  });
}

async onUnload() {
  // 卸载时清除本插件全部技能（含能力包技能）
  SkillRegistry.getInstance()?.unregisterByProvider("plugin:workflow");
}
```

## 可见性规则

技能在某个会话中可见，当且仅当：

1. 来源插件全局启用（`PluginManager.isPluginEnabled`）；
2. 若技能带 `toolkitId`（能力包注册）：
   - 该包在当前会话 `resolvePlugins` 结果中 `enabled !== false`；
   - 且 `loadMode !== "none"`（含 handler 动态决议与 `requiresAnyKits` 缺依赖）。

覆盖的路径：

| 路径 | 判定方式 |
|---|---|
| `# Skills` 清单 | `SkillOrchestrator.listSkills(..., session)` → 完整动态判定 |
| `skill_learn` 工具 | `SkillOrchestrator.skillLearn(name, session)` → 完整动态判定 |
| `/skill:<name>` 斜杠命令 | 静态判定：插件启用 + 智能体层 roleCfg（`isKitAllowedByRoleConfig`）；无会话上下文，看不到 handler 动态 `loadMode` |
| Skills 管理页 / 插件详情 | 无 session → **fail-open**（完整目录；详情页显示 `toolkitId`） |
| 无 tools 能力的模型 | `resolvedPlugins` 为空 → fail-open |

`settings.skills` 的逐项偏好仍在上述门控之上叠加（既有行为不变）。

## eager 还是 lazy？

| | eager + 技能（推荐：单入口工具） | lazy + 技能 |
|---|---|---|
| 工具定义 | 每轮在 function list（薄描述） | 仅在 `skill_learn("<kit>")` 后可见 |
| 技能正文 | `skill_learn("<skill>")` 按需 | 同左 |
| 注意 | — | **技能名不要与包 id 相同**：`skill_learn` 优先命中已注册技能，会遮蔽 lazy 包的工具定义注入（注册时会打印 warn） |

推荐模式（与 browser-script / workflow 一致）：

- 工具描述只写「能力 + PREREQUISITE: 先 skill_learn」+ 必要约定（约 400 字符）；
- 完整 API、限制、错误语义、示例放进技能正文；
- 用 `handler` 按会话收口（子代理会话 / 缺少前置配置 → `none`）。

## 与"纯技能包"的关系

只注册技能、不注册工具的能力包也可用，但注意 `applyToolPolicy`（Bot 安全模式等
逐回合工具白名单）可能因"包内无剩余允许工具"把整包置为不可用，从而隐藏其技能。
需要"纯文档包"时，优先用插件级 `api.registerSkill`（不参与工具策略）。

## 生命周期

- 技能在 `flush()` 时随工具包一起提交到 `SkillRegistry`（`provider: plugin:<id>`、
  `toolkitId: <kitId>`）。
- 插件卸载：`unregisterByProvider("plugin:<id>")` 清除全部技能（能力包技能同源）。
  与既有约定一致，清理放在 `onUnload`（禁用→启用只走 `onStart`，放 `onStop` 会让技能
  永久消失）。
- 插件禁用：技能仍在注册表中，但运行时判定第 1 条不满足 → 全局不可见；
  重新启用自动恢复。

## 实现锚点

| 关注点 | 位置 |
|---|---|
| 类型（`PluginSkillDef` / `ToolKitHandle.registerSkill`） | `backend-ts/src/modules/plugins/types/plugin.types.ts` |
| 收集与提交 | `plugins/toolkit/toolkit.ts`、`plugins/api/plugin-api.ts`（`commitPluginSkill`、`flush`） |
| 技能定义扩展 | `skills/interfaces/skill-manifest.interface.ts`（`toolkitId`） |
| 运行时判定 | `skills/core/skill-orchestrator.service.ts`（`isSkillVisibleInSession`） |
| `/skill:` 静态门控 | `plugins/utils/role-toolkit-filter.ts`（`isKitAllowedByRoleConfig`）、`skills/plugins/skill.plugin.ts`、`chat/chat.controller.ts` |
| 活样例 | `modules/workflow/workflow.plugin.ts`（`kit.registerSkill` + 子代理会话 `none`） |
