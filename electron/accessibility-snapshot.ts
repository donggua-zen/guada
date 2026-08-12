import type { WebContents } from "electron";

export interface RawAXValue {
  value?: any;
}

export interface RawAXProperty {
  name: string;
  value?: RawAXValue;
}

export interface RawAXNode {
  nodeId: string;
  ignored?: boolean;
  role?: RawAXValue;
  name?: RawAXValue;
  value?: RawAXValue;
  childIds?: string[];
  backendDOMNodeId?: number;
  properties?: RawAXProperty[];
}

export interface SimpleAXNode {
  role: string;
  name?: string;
  ref?: string;
  value?: string;
  checked?: boolean | string;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  pressed?: boolean | string;
  children?: SimpleAXNode[];
}

export interface AXSnapshotStats {
  rawNodeCount: number;
  outputNodeCount: number;
  interactiveNodeCount: number;
  maxDepth: number;
  omittedNodeCount: number;
}

export interface AXSnapshotOptions {
  maxNodes?: number;
  maxNameLength?: number;
  commandTimeoutMs?: number;
}

export interface AXSnapshotResult {
  tree: SimpleAXNode;
  refTargets: Array<{ ref: string; backendDOMNodeId: number }>;
  stats: AXSnapshotStats;
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "gridcell",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const SEMANTIC_ROLES = new Set([
  "article",
  "banner",
  "cell",
  "columnheader",
  "complementary",
  "contentinfo",
  "dialog",
  "document",
  "form",
  "grid",
  "heading",
  "main",
  "navigation",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "table",
  "tabpanel",
  "tree",
]);

const FLATTENABLE_ROLES = new Set([
  "generic",
  "group",
  "none",
  "presentation",
  "section",
  "paragraph",
  "list",
  "listitem",
  "listmarker",
]);

const DROP_ROLES = new Set(["inlinetextbox", "linebreak"]);

// 这些原子控件的 accessible name 已聚合内部文本/图像；复合控件必须保留子项。
const ATOMIC_INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "radio",
  "scrollbar",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

function readAXValue(value?: RawAXValue): any {
  return value?.value;
}

function normalizeRole(value: any): string {
  const raw = String(value || "generic").toLowerCase();
  const map: Record<string, string> = {
    rootwebarea: "document",
    webarea: "document",
    inputtime: "textbox",
    textarea: "textbox",
    textfield: "textbox",
    statictext: "text",
  };
  return map[raw] || raw;
}

function normalizeText(value: any, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function readProperty(node: RawAXNode, name: string): any {
  return readAXValue(node.properties?.find((p) => p.name === name)?.value);
}

function normalizeBoolean(value: any): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function normalizeTriState(value: any): boolean | string | undefined {
  const booleanValue = normalizeBoolean(value);
  if (booleanValue !== undefined) return booleanValue;
  if (value === "mixed") return "mixed";
  return value === undefined ? undefined : String(value);
}

function hasMeaningfulState(node: SimpleAXNode): boolean {
  return (
    node.value !== undefined ||
    node.checked !== undefined ||
    node.selected !== undefined ||
    node.expanded !== undefined ||
    node.disabled !== undefined ||
    node.pressed !== undefined
  );
}

function applyState(raw: RawAXNode, output: SimpleAXNode, maxNameLength: number): void {
  const value = normalizeText(readAXValue(raw.value), maxNameLength);
  if (value !== undefined) output.value = value;

  const checked = normalizeTriState(readProperty(raw, "checked"));
  if (checked !== undefined) output.checked = checked;

  const selected = normalizeBoolean(readProperty(raw, "selected"));
  if (selected !== undefined) output.selected = selected;

  const expanded = normalizeBoolean(readProperty(raw, "expanded"));
  if (expanded !== undefined) output.expanded = expanded;

  const disabled = normalizeBoolean(readProperty(raw, "disabled"));
  if (disabled !== undefined) output.disabled = disabled;

  const pressed = normalizeTriState(readProperty(raw, "pressed"));
  if (pressed !== undefined) output.pressed = pressed;
}

export function measureSimpleTree(
  tree: SimpleAXNode,
): Omit<AXSnapshotStats, "rawNodeCount" | "omittedNodeCount"> {
  let outputNodeCount = 0;
  let interactiveNodeCount = 0;
  let maxDepth = 0;

  const walk = (node: SimpleAXNode, depth: number) => {
    outputNodeCount++;
    if (node.ref && node.ref !== "root") interactiveNodeCount++;
    maxDepth = Math.max(maxDepth, depth);
    node.children?.forEach((child) => walk(child, depth + 1));
  };
  walk(tree, 0);

  return { outputNodeCount, interactiveNodeCount, maxDepth };
}

/**
 * 将 CDP Accessibility.getFullAXTree 返回节点压缩为适合 AI 的语义树。
 */
export function buildSimpleAccessibilityTree(
  nodes: RawAXNode[],
  options: AXSnapshotOptions = {},
): AXSnapshotResult {
  const maxNodes = options.maxNodes ?? 500;
  const maxNameLength = options.maxNameLength ?? 160;
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childIds = new Set(nodes.flatMap((node) => node.childIds || []));
  const root =
    nodes.find((node) => normalizeRole(readAXValue(node.role)) === "document") ||
    nodes.find((node) => !childIds.has(node.nodeId)) ||
    nodes[0];

  if (!root) {
    return {
      tree: { role: "document", ref: "root" },
      refTargets: [],
      stats: {
        rawNodeCount: 0,
        outputNodeCount: 1,
        interactiveNodeCount: 0,
        maxDepth: 0,
        omittedNodeCount: 0,
      },
    };
  }

  let emitted = 0;
  let omittedNodeCount = 0;
  let refCounter = 0;
  const refTargets: AXSnapshotResult["refTargets"] = [];
  const countSubtree = (raw: RawAXNode): number =>
    1 +
    (raw.childIds || []).reduce((count, id) => {
      const child = byId.get(id);
      return count + (child ? countSubtree(child) : 0);
    }, 0);

  const convert = (raw: RawAXNode, isRoot = false): SimpleAXNode[] => {
    const convertChildren = () =>
      (raw.childIds || []).flatMap((id) => {
        const child = byId.get(id);
        return child ? convert(child) : [];
      });

    if (raw.ignored) return convertChildren();

    const role = normalizeRole(readAXValue(raw.role));
    if (DROP_ROLES.has(role)) return [];

    const output: SimpleAXNode = {
      role: isRoot ? "document" : role,
    };
    const name = normalizeText(readAXValue(raw.name), maxNameLength);
    if (name) output.name = name;
    applyState(raw, output, maxNameLength);

    const interactive = INTERACTIVE_ROLES.has(role);
    const meaningfulInteractive =
      interactive &&
      (Boolean(raw.backendDOMNodeId) || Boolean(name) || hasMeaningfulState(output));
    const semantic = isRoot || SEMANTIC_ROLES.has(role);
    const namedContainer = Boolean(name) && !FLATTENABLE_ROLES.has(role);
    const shouldKeep = meaningfulInteractive || semantic || namedContainer || hasMeaningfulState(output);

    if (!shouldKeep || (FLATTENABLE_ROLES.has(role) && !name && !hasMeaningfulState(output))) {
      return convertChildren();
    }

    if (!isRoot && emitted >= maxNodes) {
      omittedNodeCount += countSubtree(raw);
      return [];
    }
    emitted++;

    if (isRoot) {
      output.ref = "root";
    } else if (meaningfulInteractive && raw.backendDOMNodeId) {
      const ref = `e${refCounter++}`;
      output.ref = ref;
      refTargets.push({ ref, backendDOMNodeId: raw.backendDOMNodeId });
    }

    // 原子控件和标题的 accessible name 已聚合内部文本/图像；复合控件保留 option/treeitem 等子项。
    const suppressChildren =
      (ATOMIC_INTERACTIVE_ROLES.has(role) && Boolean(name)) ||
      (role === "heading" && Boolean(name));
    const childNodes = suppressChildren ? [] : convertChildren();
    if (childNodes.length > 0) output.children = childNodes;
    return [output];
  };

  const converted = convert(root, true);
  const tree = converted[0] || { role: "document", ref: "root" };
  if (omittedNodeCount > 0) {
    tree.children ||= [];
    tree.children.push({ role: "omitted", name: `${omittedNodeCount} nodes omitted` });
  }
  const stats = measureSimpleTree(tree);

  return {
    tree,
    refTargets,
    stats: {
      rawNodeCount: nodes.length,
      ...stats,
      omittedNodeCount,
    },
  };
}

/**
 * 将旧 DOM role/ref 树压平为 simple 风格，供 CDP 不可用时回退。
 */
export function buildSimpleTreeFromLegacyStruct(struct: any): SimpleAXNode {
  const convert = (node: any, isRoot = false): SimpleAXNode[] => {
    if (!node || typeof node === "string") return [];
    const role = normalizeRole(node.role);
    const children = Array.isArray(node.children)
      ? node.children.flatMap((child: any) => convert(child))
      : [];
    const name = normalizeText(node.name ?? node.text, 160);
    const output: SimpleAXNode = { role: isRoot ? "document" : role };
    if (name) output.name = name;
    if (isRoot) output.ref = "root";
    else if (node.ref && INTERACTIVE_ROLES.has(role)) output.ref = node.ref;

    const keep = isRoot || INTERACTIVE_ROLES.has(role) || SEMANTIC_ROLES.has(role) || Boolean(name);
    if (!keep || (FLATTENABLE_ROLES.has(role) && !name)) return children;
    if (children.length) output.children = children;
    return [output];
  };

  return convert(struct, true)[0] || { role: "document", ref: "root" };
}

/**
 * 通过 CDP 获取并压缩 AX 树，同时把 ref 写回真实 DOM 元素。
 */
export async function captureAccessibilitySnapshot(
  webContents: WebContents,
  options: AXSnapshotOptions = {},
): Promise<{ tree: SimpleAXNode; stats: AXSnapshotStats }> {
  const debuggerApi = webContents.debugger;
  const wasAlreadyAttached = debuggerApi.isAttached();

  const commandTimeoutMs = options.commandTimeoutMs ?? 15000;
  const deadline = Date.now() + commandTimeoutMs;
  let detachedExternally = false;
  const onDetach = () => {
    detachedExternally = true;
  };
  const withTimeout = async <T>(promise: Promise<T>, operation: string): Promise<T> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Accessibility snapshot timed out after ${commandTimeoutMs}ms`);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${operation} exceeded snapshot deadline`)),
            remainingMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const sendCommand = <T = any>(method: string, params?: any) =>
    withTimeout(
      debuggerApi.sendCommand(method, params) as Promise<T>,
      method,
    );

  let attachedByUs = false;
  debuggerApi.once("detach", onDetach);

  try {
    if (!wasAlreadyAttached) {
      debuggerApi.attach("1.3");
      attachedByUs = true;
    }
    await sendCommand("Accessibility.enable");
    const result = await sendCommand<{ nodes?: RawAXNode[] }>(
      "Accessibility.getFullAXTree",
    );
    if (!result.nodes?.length) {
      throw new Error("Accessibility tree is empty");
    }
    const converted = buildSimpleAccessibilityTree(result.nodes, options);

    await withTimeout(
      webContents.executeJavaScript(`
        document.querySelectorAll('[data-ai-ref]').forEach(function(el) {
          el.removeAttribute('data-ai-ref');
        });
      `),
      "clear data-ai-ref",
    );

    const failedRefs = new Set<string>();
    for (const target of converted.refTargets) {
      let objectId: string | undefined;
      try {
        const resolved = await sendCommand<{ object?: { objectId?: string } }>(
          "DOM.resolveNode",
          { backendNodeId: target.backendDOMNodeId },
        );
        objectId = resolved.object?.objectId;
        if (!objectId) {
          failedRefs.add(target.ref);
          continue;
        }
        const call = await sendCommand<{ result?: { value?: boolean } }>(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration:
              "function(ref) { if (!(this instanceof Element) || window !== window.top) return false; this.setAttribute('data-ai-ref', ref); return true; }",
            arguments: [{ value: target.ref }],
            returnByValue: true,
          },
        );
        if (call.result?.value !== true) failedRefs.add(target.ref);
      } catch {
        if (Date.now() >= deadline) {
          throw new Error(`Accessibility snapshot timed out after ${commandTimeoutMs}ms`);
        }
        failedRefs.add(target.ref);
      } finally {
        if (objectId) {
          await sendCommand("Runtime.releaseObject", { objectId }).catch(() => {});
        }
      }
    }

    if (failedRefs.size > 0) {
      const stripFailedRefs = (node: SimpleAXNode) => {
        if (node.ref && failedRefs.has(node.ref)) delete node.ref;
        node.children?.forEach(stripFailedRefs);
      };
      stripFailedRefs(converted.tree);
    }

    const measured = measureSimpleTree(converted.tree);
    return {
      tree: converted.tree,
      stats: {
        rawNodeCount: converted.stats.rawNodeCount,
        ...measured,
        omittedNodeCount: converted.stats.omittedNodeCount,
      },
    };
  } finally {
    if (attachedByUs && !detachedExternally) {
      await sendCommand("Accessibility.disable").catch(() => {});
      if (debuggerApi.isAttached()) debuggerApi.detach();
    } else if (!attachedByUs) {
      // Debugger was already attached by caller — only disable AX domain, don't detach.
      await sendCommand("Accessibility.disable").catch(() => {});
    }
    debuggerApi.removeListener("detach", onDetach);
  }
}
