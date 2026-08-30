import { Injectable } from "@nestjs/common";
import { homedir } from "os";
import { PluginBase } from "../../plugins/base-plugin";
import { PluginApi } from "../../plugins/api/plugin-api";
import { SkillLoaderService } from "../core/skill-loader.service";
import { SkillRegistry } from "../core/skill-registry.service";
import path from "path";

/**
 * 内置技能插件
 *
 * 职责：注册系统内置技能（skill-creator / skill-installer）。
 * 与 framework 插件（skill）分离——本插件只是"框架下的普通技能集"，
 * 可被独立禁用，而无需关闭整个 skill 体系：
 *  - onLoad：注册两个内置技能（共享 bundled-skills/ 资源目录）
 *  - onStop ：禁用时撤销本插件已注册的全部技能（技能从注册表消失）
 *
 * 用 core 分类（非 system/essential）→ 允许独立启停。
 */
@Injectable()
export class SkillBundledPlugin extends PluginBase {
  manifest = {
    id: "skill-bundled",
    name: "内置技能",
    version: "1.0.0",
    description: "系统内置技能（skill-creator / skill-installer），可单独启用/停用",
    category: "core" as const,
  };
  private readonly BUNDLED_DIR = path.join(process.cwd(), "bundled-skills");
  private readonly SKILL_NAMES = ["skill-creator", "skill-installer"];

  constructor(
    private loader: SkillLoaderService,
    private registry: SkillRegistry,
  ) {
    super();
  }

  async onLoad(api: PluginApi) {
    for (const name of this.SKILL_NAMES) {
      try {
        const { manifest, body } = await this.loader.extractSkill(
          path.join(this.BUNDLED_DIR, name),
        );
        // 替换 {SKILL_DIR} 为实际用户技能目录路径（SKILL.md 内占位符 → 真实路径）
        const skillsDir = homedir().replace(/\\/g, "/") + "/.guada/skills";
        const resolved = body.replace(/\{SKILL_DIR\}/g, skillsDir);
        api.registerSkill({
          name,
          description: manifest.description,
          content: resolved,
          version: manifest.version,
          author: manifest.author,
          tags: manifest.tags,
          // 两个技能共享同一资源目录（bundled-skills/），脚本 scripts/validate-skill.mjs 仅一份
          resourceBase: { kind: "directory", path: this.BUNDLED_DIR },
        });
      } catch (err: any) {
        console.warn(
          `[skill-bundled] 注册内置技能失败 ${name}: ${err?.message || err}`,
        );
      }
    }
    console.log(
      `[skill-bundled] 已注册内置技能: ${this.SKILL_NAMES.join(", ")}`,
    );
  }

  /** 禁用插件时，撤销本插件注册的全部技能 */
  async onStop() {
    this.registry.unregisterByProvider("plugin:skill-bundled");
    console.log(`[skill-bundled] 已撤销内置技能`);
  }
}
