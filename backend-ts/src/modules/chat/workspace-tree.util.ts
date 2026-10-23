import * as fsp from "fs/promises";
import * as path from "path";

/**
 * 工作区目录树节点（后端 workspace/tree 与 workspace/children 的条目形状）。
 * `truncated` 表示该目录的子项被 maxEntries 截断。
 */
export interface WorkspaceTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: WorkspaceTreeNode[];
  hasChildren?: boolean;
  truncated?: boolean;
}

export interface BoundedDirectoryTree {
  nodes: WorkspaceTreeNode[];
  /** 当前目录的条目数超过 maxEntries */
  truncated: boolean;
}

/** 单目录最多返回的条目数：防止 5 万条目的目录一次性变成 JSON/DOM */
export const MAX_TREE_ENTRIES_PER_DIR = 2000;

/**
 * 有界构建目录树（默认只加载一层）。
 *
 * 与旧实现的区别：用 `opendir` 流式读取，收集到 maxEntries 就停止，不再先把
 * 整个目录的 `Dirent[]` 读进内存再排序。超大目录只保留前 maxEntries 条（文件系统
 * 枚举顺序），并由 `truncated` 告知调用方/前端显示提示。
 */
export async function buildDirectoryTreeBounded(
  dirPath: string,
  relativePath: string = "",
  currentDepth: number = 0,
  maxDepth: number = 0,
  maxEntries: number = MAX_TREE_ENTRIES_PER_DIR,
): Promise<BoundedDirectoryTree> {
  let dir: Awaited<ReturnType<typeof fsp.opendir>> | undefined;
  try {
    dir = await fsp.opendir(dirPath);
    const entries: Array<{ name: string; isDirectory: boolean }> = [];
    let truncated = false;

    for await (const entry of dir) {
      // 与旧实现一致：只跳过 node_modules，保留隐藏目录（如 .guada）
      if (entry.name === "node_modules") continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      entries.push({ name: entry.name, isDirectory: entry.isDirectory() });
    }

    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const nodes = await Promise.all(
      entries.map(async (entry): Promise<WorkspaceTreeNode> => {
        const relPath = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        const node: WorkspaceTreeNode = {
          name: entry.name,
          path: relPath,
          isDirectory: entry.isDirectory,
        };

        if (entry.isDirectory) {
          if (currentDepth < maxDepth) {
            const child = await buildDirectoryTreeBounded(
              path.join(dirPath, entry.name),
              relPath,
              currentDepth + 1,
              maxDepth,
              maxEntries,
            );
            node.children = child.nodes;
            if (child.truncated) node.truncated = true;
          } else {
            node.hasChildren = true;
            node.children = [];
          }
        }
        return node;
      }),
    );

    return { nodes, truncated };
  } catch {
    return { nodes: [], truncated: false };
  } finally {
    if (dir) {
      try {
        await dir.close();
      } catch {
        // for-await 正常结束时目录已自动关闭
      }
    }
  }
}
