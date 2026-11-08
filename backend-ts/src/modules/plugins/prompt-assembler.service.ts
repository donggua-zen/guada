import { Injectable, Logger } from "@nestjs/common";
import { PromptCollector } from "./prompt-collector.service";
import { PluginRegistry } from "./registry/plugin-registry";
import {
  AssembledPromptSection,
  PluginContext,
  PromptAssembly,
  PromptSectionDef,
  ResolvedPluginInfo,
} from "./types/plugin.types";

export interface AssemblePromptInput {
  /** 会话/智能体自带 systemPrompt */
  basePrompt: string;
  resolvedPlugins: ResolvedPluginInfo[];
  context: PluginContext;
  /**
   * 是否允许插件改写/删除内置段（由插件设置显式开启）。
   * 默认 false：transform 若删掉 builtin.* 会被整体忽略。
   */
  allowBuiltinRewrite?: boolean;
}

/**
 * 系统提示词装配器（v2）
 *
 * 段顺序：
 *   1. builtin.agent-system（order 0）
 *   2. 插件 registerPromptSection（按 order → name）
 *   3. 旧 registerPrompt（frequency 映射到 5000+，保持历史"追加在末尾"语义）
 *
 * 装配后按 order 串行执行 registerPromptTransform。
 */
@Injectable()
export class PromptAssembler {
  private readonly logger = new Logger(PromptAssembler.name);

  constructor(private readonly promptCollector: PromptCollector) {}

  async assemble(input: AssemblePromptInput): Promise<PromptAssembly> {
    const sections: AssembledPromptSection[] = [];
    const base = (input.basePrompt || "").trim();
    if (base) {
      sections.push({ name: "builtin.agent-system", order: 0, text: base });
    }

    // v2 命名段
    for (const rp of input.resolvedPlugins) {
      if (!rp.enabled) continue;
      const defs = PluginRegistry.getPromptSections(rp.plugin.id);
      for (const def of defs) {
        if (!scopeMatches(def, input.context)) continue;
        const text = await this.resolveText(def, input.context);
        if (!text) continue;
        sections.push({
          name: def.name,
          order: def.order ?? 1000,
          text,
          pluginId: rp.plugin.id,
          complete: def.complete,
        });
      }
    }

    // 旧 registerPrompt 兼容：保持"追加在末尾"
    const legacy = await this.promptCollector.collectPrompts(
      input.resolvedPlugins,
      input.context,
    );
    legacy.forEach((piece, index) => {
      const text = String(piece.content || "").trim();
      if (!text) return;
      sections.push({
        name: `${piece.pluginId}.legacy-prompt.${index}`,
        order: 5000 + index,
        text,
        pluginId: piece.pluginId,
      });
    });

    sections.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    let assembly: PromptAssembly = {
      sections,
      systemText: joinSections(sections),
    };

    // 装配后变换
    const transforms = [];
    for (const rp of input.resolvedPlugins) {
      if (!rp.enabled) continue;
      for (const t of PluginRegistry.getPromptTransforms(rp.plugin.id)) {
        transforms.push({ pluginId: rp.plugin.id, ...t });
      }
    }
    transforms.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const t of transforms) {
      try {
        const next = await t.transform(
          { sections: assembly.sections.slice(), systemText: assembly.systemText },
          input.context,
        );
        if (!next || !Array.isArray(next.sections)) continue;
        if (!input.allowBuiltinRewrite && !hasBuiltin(next.sections)) {
          this.logger.warn(
            `prompt transform ${t.pluginId}/${t.id} removed builtin sections; ignored`,
          );
          continue;
        }
        assembly = {
          sections: next.sections,
          systemText:
            typeof next.systemText === "string"
              ? next.systemText
              : joinSections(next.sections),
        };
      } catch (err: any) {
        this.logger.warn(
          `prompt transform ${t.pluginId}/${t.id} failed: ${err?.message ?? err}`,
        );
      }
    }

    return assembly;
  }

  private async resolveText(
    def: PromptSectionDef,
    context: PluginContext,
  ): Promise<string> {
    try {
      const raw =
        typeof def.text === "function" ? await def.text(context) : def.text;
      return String(raw || "").trim();
    } catch (err: any) {
      this.logger.warn(
        `prompt section ${def.name} failed: ${err?.message ?? err}`,
      );
      return "";
    }
  }
}

function joinSections(sections: AssembledPromptSection[]): string {
  return sections
    .map((s) => s.text)
    .filter(Boolean)
    .join("\n\n");
}

function hasBuiltin(sections: AssembledPromptSection[]): boolean {
  return sections.some((s) => String(s?.name || "").startsWith("builtin."));
}

function scopeMatches(def: PromptSectionDef, context: PluginContext): boolean {
  const scope = def.scope || "global";
  if (scope === "global") return true;
  if (scope === "agent") return Boolean(context.session?.agentId);
  if (scope === "session") return Boolean(context.session?.sessionId);
  return true;
}
