// Re-export process types so consumers only need to import from this module
export type {
  ProcessStatus,
  PollResult,
  ExecuteResult,
  ProcessListEntry,
  SandboxOptions,
} from "../../modules/shell/process-manager.service";

// ── File system types ──

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  mtime: Date;
}

export interface ReplaceResult {
  matched: boolean;
  count: number;
}

// ── File watching ──

export interface FileChangeEvent {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir";
  /** Path relative to the workspace root (forward slashes) */
  path: string;
}

export interface WatchOptions {
  recursive?: boolean;
  ignore?: string[];
}

// ── Process execution ──

export interface ExecuteOptions {
  timeout: number;
  abortSignal?: AbortSignal;
  sandbox?: import("../../modules/shell/process-manager.service").SandboxOptions;
  background?: boolean;
  /** Session ID for process tracking (listBySession/drainCompleted) */
  sessionId?: string;
  /** User ID for process ownership */
  userId?: string;
}

// ── Plugin config schema (UI-driven) ──

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "select" | "textarea";
  required?: boolean;
  default?: any;
  placeholder?: string;
  /** Conditional visibility: only shown when another field equals a value */
  showIf?: { field: string; equals: any };
  /** Options for select type */
  options?: { label: string; value: any }[];
}

// ── URI parsing ──

export interface ParsedWorkspaceUri {
  scheme: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  path: string;
  query?: Record<string, string>;
}

/**
 * Parse a workspacePath string into a structured URI.
 *
 * If the string starts with a scheme prefix (e.g. `ssh://`), it is parsed as a URI.
 * Otherwise it is treated as a local filesystem path.
 *
 * @example
 * parseWorkspacePath("D:/projects/myapp")     → { scheme: "local", path: "D:/projects/myapp" }
 * parseWorkspacePath("/home/user/proj")       → { scheme: "local", path: "/home/user/proj" }
 * parseWorkspacePath("ssh://root@1.2.3.4:22/home/user/proj")
 *   → { scheme: "ssh", host: "1.2.3.4", port: 22, username: "root", path: "/home/user/proj" }
 */
export function parseWorkspacePath(pathStr: string): ParsedWorkspaceUri {
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(pathStr)) {
    const url = new URL(pathStr);
    return {
      scheme: url.protocol.replace(":", ""),
      host: url.hostname || undefined,
      port: url.port ? parseInt(url.port) : undefined,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    };
  }
  return { scheme: "local", path: pathStr };
}

// ── WorkspaceProvider interface ──

/**
 * Abstract backend for workspace file operations, search, watching, and process execution.
 *
 * Local implementation wraps fs.* / @parcel/watcher / ProcessManagerService.
 * Remote implementations (e.g. SSH) proxy all operations over the network.
 *
 * Registered via `api.registerWorkspaceProvider(factory)` in the plugin system.
 * Routed by URI scheme: `ssh://...` → SSH provider, everything else → local.
 */
export interface WorkspaceProvider {
  readonly scheme: string;

  // ── Lifecycle ──
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // ── File operations ──
  readFile(path: string, opts?: { encoding?: string }): Promise<string | Buffer>;
  writeFile(path: string, content: string | Buffer, opts?: { encoding?: string }): Promise<void>;
  /** Read a byte range of a file. Length must stay within a sane bound (see READ_CHUNK_MAX_BYTES). */
  readFileRange(path: string, offset: number, length: number): Promise<Buffer>;
  stat(path: string): Promise<FileStat>;
  readdir(path: string): Promise<DirEntry[]>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  unlink(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  /** In-place text replacement. Local: readFile+replace+writeFile. Remote: agent就地替换, zero file transfer. */
  replaceInFile(path: string, oldText: string, newText: string, opts?: { encoding?: string }): Promise<ReplaceResult>;

  // ── Search ──
  glob(
    pattern: string,
    opts: { cwd: string; ignore?: string[]; limit?: number; deep?: number },
  ): Promise<{ path: string; size: number }[]>;
  grep(
    pattern: string,
    opts: { path: string; maxResults?: number; ignore?: string[] },
  ): Promise<string[]>;

  // ── File watching ──
  watch(
    paths: string[],
    opts: WatchOptions,
    callback: (event: FileChangeEvent) => void,
  ): () => void;

  // ── Process execution (optional — not all providers support this) ──
  execute?(command: string, cwd: string, opts: ExecuteOptions): Promise<import("../../modules/shell/process-manager.service").ExecuteResult>;
  poll?(
    processId: string,
    timeoutMs: number,
    abortSignal?: AbortSignal,
  ): Promise<import("../../modules/shell/process-manager.service").PollResult | null>;
  writeToStdin?(processId: string, text: string): void;
  kill?(processId: string): import("../../modules/shell/process-manager.service").ProcessStatus | null;
  listBySession?(sessionId: string): import("../../modules/shell/process-manager.service").ProcessListEntry[];
  drainCompleted?(sessionId: string): Promise<import("../../modules/shell/process-manager.service").PollResult[]>;
}

// ── Factory ──

/**
 * Factory registered by plugins to create WorkspaceProvider instances.
 *
 * @example
 * api.registerWorkspaceProvider({
 *   scheme: "ssh",
 *   label: "SSH 远程",
 *   configSchema: [...],
 *   create: (uri) => new SshWorkspaceProvider(uri),
 *   makeCacheKey: (uri) => `ssh:${uri.username}@${uri.host}:${uri.port || 22}`,
 * });
 */
export interface WorkspaceProviderFactory {
  readonly scheme: string;
  readonly label: string;
  readonly configSchema: ConfigField[];
  create(uri: ParsedWorkspaceUri): WorkspaceProvider;
  /** Cache key for connection reuse. Same key = same provider instance. */
  makeCacheKey(uri: ParsedWorkspaceUri): string;
}

// ── Read chunking limits ──

/**
 * Max bytes returned by a single readFileRange call.
 *
 * The `read` tool uses this as a hard cap for any single read request,
 * aggregating line/char pagination on top of byte chunks. Keeps memory
 * bounded (runs decode over at most this many bytes) and limits per-request
 * bandwidth for remote providers (SSH SFTP transfers at most this many bytes).
 */
export const READ_CHUNK_MAX_BYTES = 1024 * 1024; // 1MB
