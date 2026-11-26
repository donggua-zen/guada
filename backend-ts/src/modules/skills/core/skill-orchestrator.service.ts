import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import * as path from "path";
import { SkillSourceManager } from "./skill-source.manager";
import { SkillRegistry } from "./skill-registry.service";
import { SkillLoaderService } from "./skill-loader.service";
import { SkillVersionManager } from "./skill-version-manager.service";
import { SkillToggleConfigService } from "./skill-toggle-config.service";
import { SkillDefinition, SkillLearnResult, SkillResourceBase } from "../interfaces/skill-manifest.interface";
import { PluginManager } from "../../plugins/plugin.manager";
import { isVisibleToAgent } from "../../plugins/utils/agent-visibility";
import { ToolkitCatalogService } from "../../tools/toolkit-catalog.service";
import { normalizeWorkspaceKey } from "../../../common/utils/workspace-key.util";

/**
 * Skill 匹配结果
 */
export interface SkillMatch {
  skillId: string;
  confidence: number;
  reason: string;
}

@Injectable()
export class SkillOrchestrator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SkillOrchestrator.name);

  constructor(
    private sourceManager: SkillSourceManager,
    private registry: SkillRegistry,
    private loader: SkillLoaderService,
    private versionManager: SkillVersionManager,
    private pluginManager: PluginManager,
    private toolkitCatalog: ToolkitCatalogService,
    private toggleConfig: SkillToggleConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log("Initializing Skills framework...");
    try {
      // 由 SkillsModule.onModuleInit 先调用 watcher.start() 和 sourceManager.start()
      const n = this.registry.getAll().size;
      this.logger.log(`Skills framework initialized with ${n} skills`);
    } catch (error) {
      this.logger.error(`Failed to initialize Skills framework: ${error}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log("Shutting down Skills framework...");
  }

  /**
   * 重新触发全量扫描（现有 system + global 来源重新加载）
   */
  async triggerScan(): Promise<void> {
    this.logger.log("Triggering manual scan...");
    // 重新注册 system + global，更新 registry
    await this.sourceManager.restart();
  }

  /**
   * 列出所有 Skills，支持按工作目录合并 workspace skills。
   * 优先级：workspace > global > system。
   */
  listSkills(
    filterEnabled = true,
    workspacePath?: string,
    session?: any,
  ): SkillDefinition[] {
    // 先取全量再统一过滤：启用过滤必须发生在「项目级禁用」之后，
    // 否则被项目关掉的全局技能仍会留在会话清单里（enabled 已改成 false，
    // 但 filterEnabled 那一步早就执行完了）。
    const all = Array.from(this.registry.getAll().values());

    if (!workspacePath) {
      const base = filterEnabled
        ? all.filter((s) => s.enabled !== false)
        : all;
      return this.filterByPlugins(base, session);
    }

    const wsSkills = this.getWorkspaceSkills(workspacePath);
    const merged = new Map<string, SkillDefinition>();
    for (const s of all) merged.set(s.id, s);
    for (const s of wsSkills) merged.set(s.id, s); // 同名覆盖

    // 项目级覆盖（`.guada/skills.yaml`）在合并之后套用：
    // 它可能指向全局技能（继承项）也可能指向项目自带技能，必须按最终 id 判定。
    // 因为覆盖可以「打开」全局已禁用的技能，所以必须从 registry 全量出发，
    // 由覆盖结果决定最终 enabled，最后才做启用过滤。
    const withProject = this.applyProjectOverrides(
      Array.from(merged.values()),
      workspacePath,
    );
    const base = filterEnabled
      ? withProject.filter((s) => s.enabled !== false)
      : withProject;
    return this.filterByPlugins(base, session);
  }

  /**
   * 套用项目级覆盖：命中项把 `enabled` 覆盖成项目值，并打 `projectOverride`。
   *
   * 是**投影**，不写回注册表——注册表保存全局状态，项目覆盖只影响本次调用
   * 的返回结果。这也保证「某项目里的开关」不会改变全局视图。
   *
   * 双向：项目既能 `false` 关掉全局已启用的技能，也能 `true` 打开全局已禁用的技能。
   * 未命中的技能保持原状（继承全局）。
   */
  private applyProjectOverrides(
    skills: SkillDefinition[],
    workspacePath?: string,
  ): SkillDefinition[] {
    if (!workspacePath) return skills;
    const overrides = this.toggleConfig.getProjectOverrides(workspacePath);
    if (overrides.size === 0) return skills;

    return skills.map((s) => {
      if (!overrides.has(s.id)) return s;
      const value = overrides.get(s.id) as boolean;
      return { ...s, enabled: value, projectOverride: value };
    });
  }

  /**
   * 某技能在指定项目下的最终生效状态。
   *
   * 优先级：项目覆盖 > 全局覆盖 > 默认启用。
   *
   * @returns
   * - `enabled`：最终是否可用
   * - `source`：本次结论来自哪一层（`project` = 项目显式覆盖；`global` = 全局状态）
   * - `projectOverride`：项目显式覆盖值；undefined = 继承全局
   */
  resolveSkillEnabled(
    skillId: string,
    workspacePath?: string,
  ): { enabled: boolean; source: "project" | "global"; projectOverride?: boolean } {
    const id = String(skillId || "").toLowerCase();
    const projectOverride = workspacePath
      ? this.toggleConfig.getProjectOverride(workspacePath, id)
      : undefined;

    if (projectOverride !== undefined) {
      return { enabled: projectOverride, source: "project", projectOverride };
    }

    const globalSkill = this.registry.get(id);
    // 项目独有技能不在注册表里：存在即启用（除非项目显式关掉，上面已处理）
    if (!globalSkill) return { enabled: true, source: "global" };
    return { enabled: globalSkill.enabled !== false, source: "global" };
  }

  /**
   * 取某工作目录的项目技能（只读缓存，不触发加载）。
   *
   * 键优先用归一化 pathKey（`D:\a` 与 `d:/a/` 同一来源）；找不到时回退旧实现
   * 的原始字符串键，兼容升级前已注册的来源。
   */
  private getWorkspaceSkills(workspacePath: string): SkillDefinition[] {
    // 可选调用：测试/嵌入场景的替身可能只实现 getSourceSkills
    const byKey = this.sourceManager.getWorkspaceSkillsByPathKey?.(
      normalizeWorkspaceKey(workspacePath),
    ) ?? [];
    if (byKey.length > 0) return byKey;
    return this.sourceManager.getSourceSkills("workspace_" + workspacePath);
  }

  /**
   * 确保某工作目录的项目技能来源已加载（目录不存在时返回空，不建目录）。
   * 技能管理页与单技能解析都走这里，不依赖「会话开始跑」事件。
   */
  async ensureProjectSkills(workspacePath: string): Promise<SkillDefinition[]> {
    if (!this.sourceManager.ensureWorkspaceSource) {
      return this.getWorkspaceSkills(workspacePath);
    }
    const ensured = await this.sourceManager.ensureWorkspaceSource(workspacePath);
    if (ensured.length > 0) return ensured;
    // 兜底：确保过程中目录被删但旧来源仍在时，ensure 已注销，这里返回空即可
    return this.getWorkspaceSkills(workspacePath);
  }

  /**
   * 单技能在此会话是否可见（插件启停过滤，对齐工具"插件关闭→搜集跳过"）。
   * 非插件技能（file/workspace）始终可见；插件技能在插件未启用或已卸载时不可见。
   *
   * 插件启用状态以 PluginManager 为权威（instance.enabled，与注册/启停同源）。
   * 不能依赖 session.getResolvedPlugins()：skill 工具包 handler 在 resolvePlugins
   * 执行期间被调用，此刻 resolvedPlugins 尚未赋值（恒为空数组），会导致插件技能
   * 被误判不可见（循环依赖）。
   */
  isPluginSkillVisible(skill: SkillDefinition): boolean {
    if (!skill.provider || !skill.provider.startsWith("plugin:")) return true;
    const pluginId = skill.provider.slice("plugin:".length);
    return this.pluginManager.isPluginEnabled(pluginId);
  }

  /**
   * v4.1：能力包技能在当前会话是否可见。
   *
   * 判定：插件全局启用 &&（若技能归属工具包）该包在本会话 resolved 视图中
   * `enabled !== false && loadMode !== "none"`。loadMode 含 handler 的动态决议
   * （如 workflow 在子代理会话返回 none）与智能体层裁剪结果，因此技能会随
   * 「智能体禁用工具包 / 无启用子代理 / 子代理会话」同步显隐。
   *
   * 无 session（Skills 管理页、命令面板目录）只做插件启停门禁：插件禁用后其技能
   * 不再出现在管理列表与 / 面板（kit 检查依赖 resolved 视图，无 session 时跳过）。
   * resolvedPlugins 为空时 fail-open：无 tools 能力的模型 skill 清单本就无意义，
   * 或上下文尚未初始化。
   */
  isSkillVisibleInSession(skill: SkillDefinition, session?: any): boolean {
    if (!this.isPluginSkillVisible(skill)) return false;
    if (!skill.toolkitId) return true;
    if (!session) return true;

    const resolved: any[] =
      typeof session.getResolvedPlugins === "function"
        ? session.getResolvedPlugins() || []
        : [];
    if (resolved.length === 0) return true;

    const pluginId = skill.provider?.startsWith("plugin:")
      ? skill.provider.slice("plugin:".length)
      : "";
    if (!pluginId) return true;
    const rp = resolved.find((p) => p?.plugin?.id === pluginId);
    if (!rp || !rp.enabled) return false;
    const kit = (rp.enabledToolKits || []).find(
      (k: any) => k?.id === skill.toolkitId,
    );
    return !!kit && kit.enabled !== false && kit.loadMode !== "none";
  }

  /**
   * 按会话过滤技能集合。
   * 无 session（Skills 管理页 / 命令面板目录）也按插件启停过滤：
   * 插件禁用后其技能不再出现在管理列表与 / 面板（此前为 fail-open）。
   */
  private filterByPlugins(
    skills: SkillDefinition[],
    session?: any,
  ): SkillDefinition[] {
    return skills.filter((s) => this.isSkillVisibleInSession(s, session));
  }

  /**
   * 是否为「智能体专属技能」——注册时声明了 visibleTo。
   *
   * 这类技能由插件绑定到指定智能体（如 `visibleTo: ['self']` 只给插件自己
   * 注册的智能体），不是全局共享能力：既不能在其他智能体上启用，
   * 也不该出现在全局技能管理里。
   */
  isAgentScopedSkill(skill: SkillDefinition): boolean {
    const scope = (skill as any).visibleTo;
    return Array.isArray(scope) && scope.length > 0;
  }

  /**
   * 智能体视角：全局共享技能 + 该智能体专属技能（visibleTo 放行的那部分）。
   *
   * 用于**智能体配置页**——那里需要看到"这个智能体能用的全部技能"，
   * 其中插件绑定的专属技能以锁定态展示。而全局技能管理页只列全局共享技能
   * （见 `listManageableSkills`），两者口径不同，不能共用。
   *
   * @param agentId 目标智能体 id；为空时退化为 `listManageableSkills`
   */
  listSkillsForAgent(agentId: string | null | undefined, filterEnabled = false): SkillDefinition[] {
    const all = this.listSkills(filterEnabled);
    if (!agentId) return this.listManageableSkills(filterEnabled);
    return all.filter((s) => {
      if (!this.isAgentScopedSkill(s)) return true;
      const provider = String(s.provider || "");
      const ownerPluginId = provider.startsWith("plugin:")
        ? provider.substring("plugin:".length)
        : "";
      return isVisibleToAgent((s as any).visibleTo, ownerPluginId, agentId);
    });
  }

  /**
   * 管理页口径：只列**全局共享**技能。
   *
   * 全局技能管理页展示的是"所有智能体都能用的能力"，因此把智能体专属技能
   * （visibleTo 非空）排除在外——它们随智能体绑定，在管理页既不能开关、
   * 也无法被其他智能体使用，列出来只会误导。
   *
   * 注意：会话内的技能清单（`# Skills` 段、`skill_learn`）走的是
   * `isSkillVisibleInSession` + `isVisibleToAgent`，与这里互不影响。
   */
  listManageableSkills(filterEnabled = false): SkillDefinition[] {
    return this.listSkills(filterEnabled).filter(
      (s) => !this.isAgentScopedSkill(s),
    );
  }

  /**
   * 管理页口径 × 项目作用域：该项目可用技能（全局 + 项目 `.guada/skills`，同名覆盖）。
   *
   * 与全局管理页的差别只有「合并项目来源」与「覆盖标记」，智能体专属技能
   * 仍按管理面口径排除（不因选了项目而暴露）。
   *
   * 覆盖标记是**投影**：`overridden: true` 表示同 id 在全局也存在、且本次返回的
   * 是项目版本。不写回注册表，避免全局视图被污染。
   */
  listManageableSkillsForProject(
    workspacePath: string | undefined,
    filterEnabled = false,
  ): SkillDefinition[] {
    if (!workspacePath) return this.listManageableSkills(filterEnabled);

    const base = this.listSkills(filterEnabled); // 含可见性/插件过滤
    const baseIds = new Set(base.map((s) => s.id));
    // listSkills 已套用项目禁用（enabled=false + projectDisabled），
    // 这里只补「同名覆盖」标记。
    const merged = this.listSkills(filterEnabled, workspacePath);

    return merged
      .filter((s) => !this.isAgentScopedSkill(s))
      .map((s) =>
        s.source === "workspace" && baseIds.has(s.id)
          ? { ...s, overridden: true }
          : s,
      );
  }

  /**
   * 解析生效版本的技能定义（项目优先 → 全局注册表）。
   *
   * 列表/详情/文档/重载/学习必须共用同一口径：同名技能在项目里覆盖全局时，
   * 只要页面显示了项目版本，文档与重载就绝不能命中全局那份。
   *
   * @param workspacePath 项目主工作目录；缺省时等价于全局解析
   * @param manageableOnly true 时按管理面口径排除智能体专属技能（管理页默认）
   */
  resolveEffectiveSkill(
    skillId: string,
    workspacePath?: string,
    manageableOnly = true,
  ): SkillDefinition | null {
    const id = String(skillId || "").toLowerCase();
    if (!id) return null;

    let skill: SkillDefinition | undefined;
    if (workspacePath) {
      skill = this.getWorkspaceSkills(workspacePath).find((s) => s.id === id);
    }
    if (!skill) skill = this.registry.get(id);
    if (!skill) return null;
    if (manageableOnly && this.isAgentScopedSkill(skill)) return null;
    return skill;
  }

  /** 管理页单条查询：智能体专属技能按「不存在」处理（详情/文档/卸载/更新一致） */
  getManageableSkillDetail(
    skillId: string,
    workspacePath?: string,
  ): SkillDefinition | null {
    return this.resolveEffectiveSkill(skillId, workspacePath, true);
  }

  /** 判断某技能是否来自项目目录（项目视图只读，前端据此禁用启停/卸载） */
  static isProjectSkill(skill: SkillDefinition | null | undefined): boolean {
    return !!skill && skill.source === "workspace";
  }

  /**
   * 获取 Skill 详情
   */
  getSkillDetail(skillId: string): SkillDefinition | null {
    return this.registry.get(skillId) || null;
  }

  async enableSkill(skillId: string): Promise<void> {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    if (skill.provider?.startsWith("plugin:")) {
      throw new Error(
        `Skill ${skillId} 由插件提供，请到「插件」页面控制启停`,
      );
    }
    return this.registry.enable(skillId);
  }

  async disableSkill(skillId: string): Promise<void> {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill ${skillId} not found`);
    if (skill.provider?.startsWith("plugin:")) {
      throw new Error(
        `Skill ${skillId} 由插件提供，请到「插件」页面控制启停`,
      );
    }
    return this.registry.disable(skillId);
  }

  async batchToggleSkills(skillIds: string[], enabled: boolean): Promise<void> {
    return this.registry.batchToggle(skillIds, enabled);
  }

  /**
   * 获取 Skill 的完整文档内容（SKILL.md）
   */
  async getSkillDocumentation(skillId: string): Promise<string | null> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }
    return await this.loader.loadInstructions(skill);
  }

  /**
   * 通过名称获取技能内容（纯正文，不含 YAML 头）和位置信息
   * 供 skill_learn 工具调用。
   *
   * 解析顺序：真实技能 → 退役工具包迁移提示 → 懒加载工具包（动态工具技能）。
   * 工具包 fallback 是 tool_learn 退役后的等价入口：内容为工具定义 + 使用说明，
   * 无资源目录，kind="tool" 供 skill_learn 跳过位置头。
   */
  async skillLearn(
    name: string,
    session?: any,
  ): Promise<SkillLearnResult | null> {
    const id = name.toLowerCase();

    // 项目优先：同一 id 在项目 `.guada/skills` 里存在时，学习到的必须是项目版本，
    // 否则「清单显示项目技能、读出来却是全局同名版本」。目录不存在时 ensure 返回空，
    // 自然回落到全局注册表。
    let skill: SkillDefinition | undefined;
    const workspacePath: string | undefined = session?.workspacePath;
    if (workspacePath) {
      const wsSkills = await this.ensureProjectSkills(workspacePath);
      skill = wsSkills.find((s) => s.id === id);
    }
    if (!skill) skill = this.registry.get(id);

    if (skill) {
      // 对齐工具：插件关闭（当前会话岗位/智能体配置下未启用）或所属能力包
      // 本会话不可用（智能体禁用/子代理会话等）→ 该技能等同于不存在
      if (!this.isSkillVisibleInSession(skill, session)) return null;
      // 与清单保持同一口径：最终生效状态（项目覆盖 > 全局覆盖 > 默认启用）。
      // 此前只校验了「项目禁用」，全局已禁用的技能仍能被按名学习——
      // 那是「清单看不到却学得到」的后门，这里一并校验。
      if (!this.resolveSkillEnabled(skill.id, workspacePath).enabled) return null;
      return this.loadRealSkill(skill);
    }

    // 旧工具包退役：返回迁移提示，避免模型把"找不到"误判为临时故障
    const retired = this.toolkitCatalog.retiredToolkitMessage(name);
    if (retired) {
      return {
        name: name.toLowerCase(),
        content: retired,
        path: "",
        resourceBase: null,
        baseDirectory: null,
        skillMdPath: null,
        kind: "tool",
      };
    }

    // 懒加载工具包（动态工具技能）
    if (session) {
      const entry = this.toolkitCatalog.resolveToolSkill(name, session);
      if (entry) {
        const content = await this.toolkitCatalog.buildToolSkillContent(entry, {
          session,
        } as any);
        return {
          name: entry.id,
          content,
          path: "",
          resourceBase: null,
          baseDirectory: null,
          skillMdPath: null,
          kind: "tool",
        };
      }
    }

    return null;
  }

  /** 加载真实技能正文与位置信息（原 skillLearn 主体） */
  private async loadRealSkill(
    skill: SkillDefinition,
  ): Promise<SkillLearnResult> {
    const content = await this.loader.loadInstructions(skill);

    // 位置信息分两类：
    // - 文件型技能（有磁盘 SKILL.md）：技能自身目录即资源根，SKILL.md 在其下。
    // - 插件注册型技能（内嵌正文、无文件）：以声明的 resourceBase 目录为资源根
    //   （内置技能共享 bundled-skills/，脚本在 scripts/ 下），无文件可续读。
    // 都没有来源时保持 null——宁可说"未知"，也不拼出 __plugin__ 这类假路径。
    const skillDir = skill.baseDir
      ? path.join(skill.baseDir, skill.basePath)
      : null;
    const fileBacked = !skill.content && !!skillDir;

    let baseDirectory: string | null = null;
    if (skill.resourceBase?.kind === "directory") {
      baseDirectory = skill.resourceBase.path;
    } else if (skillDir) {
      baseDirectory = skillDir;
    }
    const skillMdPath = fileBacked ? path.join(skillDir!, "SKILL.md") : null;

    // 未声明且无技能目录 → 保持 null：位置头会如实说"未声明资源目录"，
    // 而不是拼出 __plugin__ 这类假路径让模型去 read 一个不存在的文件。
    const resourceBase: SkillResourceBase | null =
      skill.resourceBase ??
      (skillDir ? { kind: "directory", path: skillDir } : null);

    return {
      name: skill.manifest.name,
      content,
      path: skillMdPath ?? baseDirectory ?? "",
      resourceBase,
      baseDirectory,
      skillMdPath,
    };
  }

  /**
   * 重新加载指定 Skill（项目技能时按项目来源解析，不误碰全局同名版本）
   */
  async reloadSkill(
    skillId: string,
    workspacePath?: string,
  ): Promise<SkillDefinition> {
    const skill = workspacePath
      ? this.resolveEffectiveSkill(skillId, workspacePath, false)
      : this.registry.get(skillId) || null;
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const updatedSkill = await this.loader.reloadManifest(skill);

    // 项目技能不在注册表里：回写来源缓存即可（无版本记录，跳过 versionManager）
    if (skill.source === "workspace" && workspacePath) {
      this.sourceManager.replaceSourceSkill(
        this.sourceManager.findWorkspaceSourceKey(
          normalizeWorkspaceKey(workspacePath),
        ),
        updatedSkill,
      );
      this.logger.log(`Reloaded project skill: ${skillId}`);
      return updatedSkill;
    }

    this.registry.update(updatedSkill);

    if (updatedSkill.manifest.version) {
      try {
        await this.versionManager.recordUpdate(
          skillId,
          updatedSkill.manifest.version,
          updatedSkill.contentHash,
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("not found in version records")) {
          await this.versionManager.recordInstall(
            skillId,
            updatedSkill.manifest.version,
            updatedSkill.contentHash,
          );
          this.logger.debug(
            `Created initial version record for skill: ${skillId}`,
          );
        } else {
          throw error;
        }
      }
    }

    this.logger.log(`Reloaded skill: ${skillId}`);
    return updatedSkill;
  }

  /**
   * 当前会话可学习的懒加载工具包（动态工具技能清单条目）。
   * 供技能清单 prompt 追加 <available_tool_skills> 段。
   */
  listToolSkills(session: any) {
    return this.toolkitCatalog.listToolSkills(session);
  }

  /**
   * 根据用户消息匹配相关 Skills
   */
  async matchSkills(userMessage: string): Promise<SkillMatch[]> {
    // 与可见性口径一致：禁用插件的技能不参与匹配
    const skills = Array.from(this.registry.getAll().values()).filter((s) =>
      this.isPluginSkillVisible(s),
    );
    const matches: SkillMatch[] = [];

    for (const skill of skills) {
      const keywords = [skill.manifest.name, ...(skill.manifest.tags || [])];

      const lowerMessage = userMessage.toLowerCase();
      const matchedKeywords = keywords.filter((kw) =>
        lowerMessage.includes(kw.toLowerCase()),
      );

      if (matchedKeywords.length > 0) {
        matches.push({
          skillId: skill.id,
          confidence: matchedKeywords.length / keywords.length,
          reason: `Matched keywords: ${matchedKeywords.join(", ")}`,
        });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 列出所有 Skills（元数据注入用）
   */
  getMetadataInjection(): string {
    // 与可见性口径一致：禁用插件的技能不进入注入文本
    const skills = Array.from(this.registry.getAll().values()).filter((s) =>
      this.isPluginSkillVisible(s),
    );
    if (skills.length === 0) return "";

    const metadataList = skills
      .map((skill) => `- ${skill.manifest.name}: ${skill.manifest.description}`)
      .join("\n");

    return `\n\n# Available Skills\nThe following professional skills are available. Use the skill management tools to interact with them:\n\n${metadataList}`;
  }
}
