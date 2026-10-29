import { applyToolPolicy } from './tool-policy.util';
import type { ResolvedPluginInfo } from '../types/plugin.types';
import type { ToolHandlerDef } from '../types/plugin.types';

function tool(name: string, toolSet: string): ToolHandlerDef {
  return { name, toolSet, description: name } as ToolHandlerDef;
}

function resolved(
  pluginId: string,
  kits: Array<{
    id: string;
    enabled?: boolean;
    loadMode?: 'eager' | 'lazy' | 'none';
    tools: ToolHandlerDef[];
  }>,
  opts: { enabled?: boolean } = {},
): ResolvedPluginInfo {
  const allTools = kits.flatMap((k) => k.tools);
  const enabledTools =
    opts.enabled === false
      ? []
      : kits
          .filter((k) => k.enabled !== false && k.loadMode !== 'none')
          .flatMap((k) => (k.loadMode === 'lazy' ? [] : k.tools));
  return {
    enabled: opts.enabled !== false,
    effective: 'global',
    plugin: { id: pluginId } as any,
    enabledTools,
    allTools,
    enabledToolKits: kits.map((k) => ({
      id: k.id,
      name: k.id,
      loadMode: k.loadMode ?? 'eager',
      enabled: k.enabled !== false,
      toolCount: k.tools.length,
      promptCount: 0,
    })),
    workspaceProviders: [],
    attachmentTypes: [],
    uiPages: [],
    source: 'builtin',
    pluginPath: '',
  } as unknown as ResolvedPluginInfo;
}

describe('applyToolPolicy', () => {
  it('过滤 enabledTools 与 allTools，白名单外工具一律移除', () => {
    const input = [
      resolved('file', [{ id: 'file', tools: [tool('read', 'file'), tool('write', 'file')] }]),
      resolved('shell', [{ id: 'shell', tools: [tool('run_command', 'shell')] }]),
    ];

    const out = applyToolPolicy(input, { allowedTools: ['read'] });

    const file = out.find((rp) => rp.plugin.id === 'file')!;
    expect(file.enabledTools.map((t) => t.name)).toEqual(['read']);
    expect(file.allTools.map((t) => t.name)).toEqual(['read']);
    const shell = out.find((rp) => rp.plugin.id === 'shell')!;
    expect(shell.enabledTools).toEqual([]);
    expect(shell.allTools).toEqual([]);
  });

  it('包内没有剩余允许工具时整包禁用（enabled=false, loadMode=none）', () => {
    const input = [
      resolved('shell', [{ id: 'shell', tools: [tool('run_command', 'shell')] }]),
    ];

    const out = applyToolPolicy(input, { allowedTools: ['read'] });

    expect(out[0].enabledToolKits[0]).toMatchObject({
      enabled: false,
      loadMode: 'none',
    });
  });

  it('allowedToolPrefixes 按前缀放行全部 MCP 工具', () => {
    const input = [
      resolved('mcp', [
        { id: 'mcp_alpha', tools: [tool('mcp__a1', 'mcp_alpha'), tool('mcp__a2', 'mcp_alpha')] },
        { id: 'mcp_beta', tools: [tool('mcp__b1', 'mcp_beta')] },
      ]),
      resolved('shell', [{ id: 'shell', tools: [tool('run_command', 'shell')] }]),
    ];

    const out = applyToolPolicy(input, {
      allowedTools: ['read'],
      allowedToolPrefixes: ['mcp__'],
    });

    const mcp = out[0];
    expect(mcp.enabledTools.map((t) => t.name)).toEqual(['mcp__a1', 'mcp__a2', 'mcp__b1']);
    expect(mcp.allTools.map((t) => t.name)).toEqual(['mcp__a1', 'mcp__a2', 'mcp__b1']);
    expect(mcp.enabledToolKits.every((k) => k.enabled)).toBe(true);
    // 非 MCP 工具仍被拒
    expect(out[1].enabledTools).toEqual([]);
  });

  it('懒加载工具也在 allTools 中被过滤（tool_use 通道不可绕过）', () => {
    const input = [
      resolved('universal_tools', [
        {
          id: 'lazy_tools',
          loadMode: 'lazy',
          tools: [tool('tool_use', 'lazy_tools'), tool('secret_tool', 'lazy_tools')],
        },
      ]),
    ];

    const out = applyToolPolicy(input, { allowedTools: ['tool_use'] });

    expect(out[0].allTools.map((t) => t.name)).toEqual(['tool_use']);
  });

  it('不修改入参对象', () => {
    const input = [
      resolved('file', [{ id: 'file', tools: [tool('read', 'file'), tool('write', 'file')] }]),
    ];

    applyToolPolicy(input, { allowedTools: ['read'] });

    expect(input[0].allTools.map((t) => t.name)).toEqual(['read', 'write']);
    expect(input[0].enabledTools.map((t) => t.name)).toEqual(['read', 'write']);
  });

  it('禁用的插件保持 enabled=false 且工具为空', () => {
    const input = [
      resolved('shell', [{ id: 'shell', tools: [tool('run_command', 'shell')] }], {
        enabled: false,
      }),
    ];

    const out = applyToolPolicy(input, { allowedTools: ['run_command'] });

    expect(out[0].enabled).toBe(false);
    expect(out[0].enabledTools).toEqual([]);
  });
});
