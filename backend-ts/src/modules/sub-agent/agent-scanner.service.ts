import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { readFile, writeFile, readdir, mkdir, unlink, rmdir, access } from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";

/**
 * Agent 清单（YAML frontmatter 字段）
 */
interface AgentManifest {
  name: string;
  description?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
  visible?: boolean;
}

/**
 * 文件夹元数据（_manifest.md 的 frontmatter）
 */
interface GroupManifest {
  name?: string;
  emoji?: string;
  visible?: boolean;
  collapsed?: boolean;
  description?: string;
}

/**
 * 文件夹定义
 */
export interface AgentGroup {
  id: string;          // 文件夹名，如 "developer"
  name: string;        // 展示名（从 manifest 或默认文件夹名）
  emoji: string;       // emoji 图标
  visible: boolean;    // 文件夹可见性（级联影响内部 agent）
  collapsed?: boolean; // 前端折叠状态（持久化到 manifest）
  agentCount: number;  // 内部 agent 数量
}

/** 文件夹名称正则：只允许英文、数字、下划线 */
const FOLDER_NAME_RE = /^[a-zA-Z0-9_]+$/;

/**
 * 解析后的 Agent 定义
 */
export interface AgentDefinition {
  id: string; // "agent-{filename}" 或 "agent-{folder}/{filename}"
  name: string;
  description: string;
  color: string;
  emoji: string;
  visible: boolean; // 来自文件 manifest 的原始值（不受文件夹影响）
  filePath: string; // 文件完整路径
  body: string; // frontmatter 后的 Markdown 正文
  folder?: string; // 所属文件夹名，无则 undefined
  folderVisible?: boolean; // 文件夹的 visible 状态（注入时由 presets plugin 级联使用）
}

@Injectable()
export class AgentScannerService {
  private readonly logger = new Logger(AgentScannerService.name);
  private readonly agentsDir: string;
  private cache: AgentDefinition[] | null = null;
  private groupsCache: AgentGroup[] | null = null;
  private readonly PREFIX = "agent-";

  constructor(private configService: ConfigService) {
    const dataDir =
      this.configService.get<string>("USERDATA_DIR") ||
      path.join(process.cwd(), "data");
    this.agentsDir = path.join(dataDir, "agents");
    this.logger.log(`Agent 目录: ${this.agentsDir}`);
  }

  /**
   * 列出所有 Agent（启动时扫描一次，后续手动 refresh）
   */
  async listAgents(): Promise<AgentDefinition[]> {
    if (this.cache) return this.cache;
    await this.scan();
    return this.cache!;
  }

  /**
   * 列出所有文件夹
   */
  async listGroups(): Promise<AgentGroup[]> {
    if (this.groupsCache) return this.groupsCache;
    await this.scan();
    return this.groupsCache!;
  }

  /**
   * 按 ID 获取单个 Agent
   * 支持 "agent-filename" 和 "agent-folder/filename" 两种格式
   */
  async getAgent(agentId: string): Promise<AgentDefinition | null> {
    if (!agentId.startsWith(this.PREFIX)) return null;
    const filePath = agentId.slice(this.PREFIX.length); // "folder/filename" 或 "filename"

    // 先查缓存
    const agents = this.cache ? this.cache : await this.listAgents();
    const cached = agents.find((a) => a.id === agentId);
    if (cached) return cached;

    // 缓存没有，尝试直接读文件
    const absPath = path.join(this.agentsDir, `${filePath}.md`);
    try {
      await access(absPath);
    } catch {
      return null;
    }
    return this.readAgentFile(filePath);
  }

  /**
   * 手动触发重新扫描
   */
  async refresh(): Promise<void> {
    this.cache = null;
    this.groupsCache = null;
    await this.scan();
  }

  // ── 文件夹操作 ──

  /**
   * 切换文件夹可见性（修改 _manifest.md 的 visible 字段）
   * @returns false=文件夹不存在或无 _manifest.md
   */
  async setGroupVisibility(
    groupId: string,
    visible: boolean,
    collapsed?: boolean,
  ): Promise<boolean> {
    const manifestPath = path.join(this.agentsDir, groupId, "_manifest.md");
    try {
      let content: string;
      try {
        content = await readFile(manifestPath, "utf-8");
      } catch {
        // _manifest.md 不存在，创建它
        const fields = `visible: ${visible}${collapsed !== undefined ? `\ncollapsed: ${collapsed}` : ""}`;
        content = `---\n${fields}\n---\n`;
        await writeFile(manifestPath, content, "utf-8");
        await this.refresh();
        return true;
      }
      const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
      if (match) {
        const parsed = yaml.load(match[1]) as Record<string, any>;
        if (parsed && typeof parsed === "object") {
          parsed.visible = visible;
          if (collapsed !== undefined) parsed.collapsed = collapsed;
          const newYaml = yaml.dump(parsed, { lineWidth: -1 }).trim();
          const newContent = `---\n${newYaml}\n---\n${match[2]}`;
          await writeFile(manifestPath, newContent, "utf-8");
        }
      } else {
        const fields = `visible: ${visible}${collapsed !== undefined ? `\ncollapsed: ${collapsed}` : ""}`;
        const newContent = `---\n${fields}\n---\n${content}`;
        await writeFile(manifestPath, newContent, "utf-8");
      }
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 删除整个文件夹（含所有 Agent 文件 + _manifest.md）
   */
  async deleteGroup(groupId: string): Promise<boolean> {
    const dirPath = path.join(this.agentsDir, groupId);
    try {
      const files = await readdir(dirPath);
      for (const file of files) {
        if (file.endsWith(".md")) {
          await unlink(path.join(dirPath, file));
        }
      }
      await rmdir(dirPath);
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  // ── 兼容方法：自动区分 agent / group ──

  /**
   * 设置可见性，自动区分 agent-id 和 group-id
   */
  async setVisibility(
    id: string,
    visible: boolean,
    collapsed?: boolean,
  ): Promise<boolean> {
    if (id.startsWith(this.PREFIX)) {
      return this.setAgentVisibility(id, visible);
    }
    // 非 agent- 开头 → 视为文件夹名
    return this.setGroupVisibility(id, visible, collapsed);
  }

  /**
   * 删除，自动区分 agent-id 和 group-id
   */
  async deleteAgent(id: string): Promise<boolean> {
    if (id.startsWith(this.PREFIX)) {
      return this.deleteAgentFile(id);
    }
    return this.deleteGroup(id);
  }

  // ── 私有方法 ──

  /**
   * 全量扫描 agents 目录
   */
  private async scan(): Promise<void> {
    try {
      await mkdir(this.agentsDir, { recursive: true });
    } catch {
      // 静默
    }

    const agents: AgentDefinition[] = [];
    const groups: AgentGroup[] = [];

    let entries: fs.Dirent[];
    try {
      entries = await readdir(this.agentsDir, { withFileTypes: true });
    } catch {
      this.logger.warn(`无法读取 Agent 目录: ${this.agentsDir}`);
      this.cache = agents;
      this.groupsCache = groups;
      return;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        // 根目录下的 .md 文件（排除 _manifest.md）
        if (entry.name === "_manifest.md") continue;
        const fileId = path.basename(entry.name, ".md");
        const agent = await this.readAgentFile(fileId);
        if (agent) agents.push(agent);
      } else if (
        entry.isDirectory() &&
        FOLDER_NAME_RE.test(entry.name)
      ) {
        // 一级子目录 → 按文件夹扫描
        const groupAgents = await this.scanGroup(entry.name, groups);
        agents.push(...groupAgents);
      }
    }

    this.cache = agents;
    this.groupsCache = groups;
    this.logger.log(`扫描到 ${agents.length} 个 Agent, ${groups.length} 个文件夹`);
  }

  /**
   * 扫描单个文件夹
   */
  private async scanGroup(
    groupId: string,
    groups: AgentGroup[],
  ): Promise<AgentDefinition[]> {
    const dirPath = path.join(this.agentsDir, groupId);
    const manifest = await this.readGroupManifest(groupId);

    const group: AgentGroup = {
      id: groupId,
      name: manifest.name || groupId,
      emoji: manifest.emoji || "📁",
      visible: manifest.visible !== false,
      collapsed: manifest.collapsed === true,
      agentCount: 0,
    };

    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      return [];
    }

    const results: AgentDefinition[] = [];
    for (const file of files) {
      if (!file.endsWith(".md") || file === "_manifest.md") continue;
      const fileId = `${groupId}/${path.basename(file, ".md")}`;
      const agent = await this.readAgentFile(fileId, group.visible);
      if (agent) {
        agent.folder = groupId;
        results.push(agent);
        group.agentCount++;
      }
    }

    groups.push(group);
    return results;
  }

  /**
   * 读取文件夹 _manifest.md
   */
  private async readGroupManifest(
    groupId: string,
  ): Promise<GroupManifest> {
    const manifestPath = path.join(this.agentsDir, groupId, "_manifest.md");
    try {
      const content = await readFile(manifestPath, "utf-8");
      const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
      if (match) {
        const parsed = yaml.load(match[1]) as GroupManifest;
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch {
      // 文件不存在，返回默认
    }
    return {};
  }

  /**
   * 读取并解析单个 Agent .md 文件
   * @param fileId 文件名（不含 .md），支持 "folder/filename" 格式
   * @param groupVisible 文件夹可见性（用于级联）
   */
  private async readAgentFile(
    fileId: string,
    groupVisible?: boolean,
  ): Promise<AgentDefinition | null> {
    const filePath = path.join(this.agentsDir, `${fileId}.md`);
    try {
      const content = await readFile(filePath, "utf-8");
      return this.parseAgentFile(content, fileId, filePath, groupVisible);
    } catch {
      return null;
    }
  }

  /**
   * 解析 Agent .md 文件
   */
  private parseAgentFile(
    content: string,
    fileId: string,
    filePath?: string,
    groupVisible?: boolean,
  ): AgentDefinition | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) {
      this.logger.warn(`Agent 文件缺少 frontmatter: ${fileId}.md`);
      return null;
    }

    const yamlContent = match[1];
    const body = match[2].trim();

    if (!body) {
      this.logger.warn(`Agent 文件正文为空: ${fileId}.md`);
      return null;
    }

    let manifest: AgentManifest;
    try {
      manifest = yaml.load(yamlContent) as AgentManifest;
    } catch (err: any) {
      this.logger.warn(
        `Agent 文件 YAML 解析失败: ${fileId}.md, ${err.message}`,
      );
      return null;
    }

    if (!manifest || typeof manifest !== "object" || !manifest.name) {
      this.logger.warn(`Agent 文件缺少 name 字段: ${fileId}.md`);
      return null;
    }

    // 原始值来自文件 manifest，不级联（presets plugin 注入时自行级联）
    const agentVisible = manifest.visible === true;

    return {
      id: `agent-${fileId}`,
      name: manifest.name,
      description: manifest.description || "",
      color: manifest.color || "gray",
      emoji: manifest.emoji || "🤖",
      visible: agentVisible,
      filePath: filePath || path.join(this.agentsDir, `${fileId}.md`),
      body,
      folderVisible: groupVisible,
    };
  }

  /**
   * 切换 Agent 可见性（修改文件 frontmatter 的 visible 字段）
   */
  private async setAgentVisibility(
    agentId: string,
    visible: boolean,
  ): Promise<boolean> {
    const filePath = this.resolveAgentFilePath(agentId);
    if (!filePath) return false;

    try {
      const content = await readFile(filePath, "utf-8");
      const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
      if (!match) return false;

      const yamlContent = match[1];
      const body = match[2];
      const parsed = yaml.load(yamlContent) as Record<string, any>;
      if (!parsed || typeof parsed !== "object") return false;

      parsed.visible = visible;
      const newYaml = yaml.dump(parsed, { lineWidth: -1 }).trim();
      const newContent = `---\n${newYaml}\n---\n${body}`;
      await writeFile(filePath, newContent, "utf-8");

      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 删除单个 Agent 文件
   */
  private async deleteAgentFile(agentId: string): Promise<boolean> {
    const filePath = this.resolveAgentFilePath(agentId);
    if (!filePath) return false;

    try {
      await unlink(filePath);
      await this.refresh();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 根据 agentId 解析文件绝对路径
   * "agent-filename" → agents/filename.md
   * "agent-folder/filename" → agents/folder/filename.md
   */
  private resolveAgentFilePath(agentId: string): string | null {
    if (!agentId.startsWith(this.PREFIX)) return null;
    const filePath = agentId.slice(this.PREFIX.length);
    return path.join(this.agentsDir, `${filePath}.md`);
  }
}
