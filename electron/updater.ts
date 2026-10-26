import { app, net } from "electron";
import { spawn } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import {
  CancellationToken,
  NsisUpdater,
  type ProgressInfo,
} from "electron-updater";

export interface UpdateAsset {
  url: string;
  fileName?: string;
  sha512?: string;
  size?: number;
  /** 安装包的 blockmap 直链（可选；electron-updater 会按 URL 规则自行推导）。 */
  blockmapUrl?: string;
}

export interface UpdateInfo {
  version?: string;
  clientVersion?: string;
  description?: string;
  publishDate?: string;
  mandatory?: boolean;
  downloadUrl?: string;
  releaseNotes?: string;
  downloads?: {
    win?: UpdateAsset;
  };
  [key: string]: unknown;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export type UpdateEvent =
  | { status: "available"; info: UpdateInfo }
  | { status: "not-available" }
  | { status: "downloading"; progress: UpdateProgress }
  | {
      status: "downloaded";
      version: string;
      filePath: string;
      info?: UpdateInfo;
    }
  | { status: "installing" }
  | {
      status: "error";
      phase: "check" | "download" | "install";
      error: string;
    };

export type UpdateEventSender = (event: UpdateEvent) => void;

interface PersistedUpdateState {
  version: string;
  filePath: string;
  sha512?: string;
  size?: number;
  downloadedAt: number;
}

const UPDATE_DIR_NAME = "guada-updater";
const STATE_FILE_NAME = "update-state.json";
const PROGRESS_INTERVAL_MS = 250;
const STALL_TIMEOUT_MS = 60_000;
const MIN_FREE_SPACE_MARGIN = 50 * 1024 * 1024;
const INSTALLER_ARGS = ["--updated"];

/** 允许的更新下载域名（GitCode 会 302 到 file-cdn.gitcode.com）。 */
const ALLOWED_UPDATE_HOSTS = new Set([
  "gitcode.com",
  "file-cdn.gitcode.com",
  "ai.dingd.cn",
]);

function isAllowedUpdateUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const isLocalhost =
      host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (isLocalhost) {
      // 仅用于本地联调：默认关闭，避免生产环境接受任意本地地址。
      return process.env.GUADA_UPDATE_ALLOW_LOCALHOST === "1";
    }
    if (url.protocol !== "https:") return false;
    return ALLOWED_UPDATE_HOSTS.has(host) || host.endsWith(".gitcode.com");
  } catch {
    return false;
  }
}

class UpdateIntegrityError extends Error {}

/**
 * 从安装包直链推导出同版本 release 目录，作为 electron-updater 的 generic feed。
 * 例：.../releases/download/v1.0.7/GuaDa-Setup-1.0.7.exe
 *   → .../releases/download/v1.0.7/
 */
function deriveGitCodeFeedUrl(installerUrl: string): string | null {
  try {
    const url = new URL(installerUrl);
    const host = url.hostname.toLowerCase();
    const isLocalhost =
      host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (isLocalhost) {
      // 与下载地址校验保持一致：仅开发联调允许本地 feed。
      if (process.env.GUADA_UPDATE_ALLOW_LOCALHOST !== "1") return null;
    } else {
      if (url.protocol !== "https:") return null;
      if (host !== "gitcode.com" && !host.endsWith(".gitcode.com")) {
        return null;
      }
    }
    const lastSlash = url.pathname.lastIndexOf("/");
    if (lastSlash <= 0) return null;
    return `${url.origin}${url.pathname.slice(0, lastSlash + 1)}`;
  } catch {
    return null;
  }
}

function normalizeVersion(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => parseInt(part.replace(/[^\d].*$/, ""), 10) || 0);
}

/** a < b 返回负数，a == b 返回 0，a > b 返回正数。 */
export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 启动 NSIS 安装包，显示正常安装向导。
 *
 * 参数说明（electron-builder assisted installer 模板）：
 * - `--updated`：沿用原安装目录、跳过目录选择页，并让旧卸载器保留用户数据。
 * - 不传 `/S`：显示安装向导（安装进度页 + 完成页），避免应用退出后长时间空白。
 *   完成页默认勾选「运行 GuaDa」，安装完成后会启动新版本。
 *
 * 返回的 Promise 在子进程成功创建后 resolve；创建失败（如安装包被删除）时 reject。
 */
export function launchInstaller(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(filePath, INSTALLER_ARGS, {
      cwd: path.dirname(filePath),
      detached: true,
      stdio: "ignore",
    });

    child.once("spawn", () => {
      settled = true;
      child.unref();
      resolve();
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

export class UpdateManager {
  private readonly send: UpdateEventSender;

  private availableInfo: UpdateInfo | null = null;
  private downloadAsset: UpdateAsset | null = null;

  private state: "idle" | "downloading" | "downloaded" | "installing" =
    "idle";
  private downloaded: PersistedUpdateState | null = null;
  private lastProgress: UpdateProgress | null = null;

  private request: Electron.ClientRequest | null = null;
  private response: Electron.IncomingMessage | null = null;
  private stream: fs.WriteStream | null = null;
  private stallTimer: NodeJS.Timeout | null = null;
  private cancelDownload: (() => void) | null = null;
  private cancelled = false;
  private silentAbort = false;
  private partialPath: string | null = null;

  /** electron-updater 差量下载实例（懒创建，复用同一个）。 */
  private differentialUpdater: NsisUpdater | null = null;
  private differentialToken: CancellationToken | null = null;
  private activeDownloadKind: "full" | "differential" | null = null;
  private lastDifferentialProgressAt = 0;

  constructor(send: UpdateEventSender) {
    this.send = send;
    this.downloaded = this.loadPersistedState();
  }

  setAvailableInfo(info: UpdateInfo | null): void {
    this.availableInfo = info;
    this.downloadAsset = info ? this.pickAsset(info) : null;
  }

  getDownloadAsset(): UpdateAsset | null {
    return this.downloadAsset;
  }

  getDownloadedFile(): string | null {
    if (!this.downloaded) return null;
    try {
      if (!fs.existsSync(this.downloaded.filePath)) {
        this.downloaded = null;
        this.clearPersistedState();
        return null;
      }
      return this.downloaded.filePath;
    } catch {
      return null;
    }
  }

  getDownloadedForVersion(version: string): PersistedUpdateState | null {
    if (!this.downloaded || this.downloaded.version !== version) return null;
    return this.getDownloadedFile() ? this.downloaded : null;
  }

  /** 供前端晚挂载时同步状态；没有可展示状态时返回 idle。 */
  getPublicState(): UpdateEvent {
    if (this.state === "downloading" && this.lastProgress) {
      return { status: "downloading", progress: this.lastProgress };
    }
    if (this.state === "installing") {
      return { status: "installing" };
    }
    if (this.downloaded && this.getDownloadedFile()) {
      return {
        status: "downloaded",
        version: this.downloaded.version,
        filePath: this.downloaded.filePath,
        info: this.availableInfo || undefined,
      };
    }
    return { status: "not-available" };
  }

  /**
   * 开始下载。调用方不需要 await 整个下载过程：进度和结果通过事件推送。
   * 同一时间只允许一个下载任务。
   *
   * Windows 上优先尝试 electron-updater 的 NSIS 差量下载；以下情况回退整包：
   * - 安装包不在 GitCode（无法推导 latest.yml feed）
   * - 旧/新 blockmap 缺失、旧安装包缓存缺失、Range 不被支持
   * - 网络或任何差量流程异常
   */
  async download(): Promise<void> {
    if (this.state === "downloading") {
      throw new Error("更新包正在下载中");
    }
    if (this.state === "installing") {
      throw new Error("正在安装更新");
    }

    const asset = this.downloadAsset;
    if (!asset) {
      throw new Error("当前平台不支持应用内更新，请手动下载");
    }
    if (!isAllowedUpdateUrl(asset.url)) {
      throw new Error("更新地址不受信任，已取消下载");
    }

    this.cancelled = false;
    this.silentAbort = false;

    const expectedSize = Number(asset.size || 0);
    await this.assertDiskSpace(app.getPath("userData"), expectedSize);

    const differentialHandled = await this.tryDifferentialDownload(asset);
    if (differentialHandled) return;

    await this.downloadFull(asset);
  }

  /** 用户取消下载：中断请求并删除半成品。 */
  cancel(): void {
    if (this.state !== "downloading") return;
    this.cancelled = true;
    if (this.activeDownloadKind === "differential") {
      this.differentialToken?.cancel();
      return;
    }
    this.cancelDownload?.();
  }

  /** 应用退出前静默中断下载（不向前端推送状态）。 */
  abortSilently(): void {
    if (this.state !== "downloading") return;
    this.silentAbort = true;
    this.cancelled = true;
    this.state = "idle";
    if (this.activeDownloadKind === "differential") {
      this.differentialToken?.cancel();
      return;
    }
    this.cancelDownload?.();
  }

  private async downloadFull(asset: UpdateAsset): Promise<void> {
    const dir = path.join(app.getPath("temp"), UPDATE_DIR_NAME);
    await fs.promises.mkdir(dir, { recursive: true });

    const version = String(this.availableInfo?.version || "latest");
    const fileName = this.safeFileName(asset.fileName, asset.url);
    const finalPath = path.join(dir, `${version}-${fileName}`);
    const partPath = `${finalPath}.part`;
    this.partialPath = partPath;

    const expectedSize = Number(asset.size || 0);
    await this.assertDiskSpace(dir, expectedSize);

    this.state = "downloading";
    this.activeDownloadKind = "full";
    this.lastProgress = {
      percent: 0,
      transferred: 0,
      total: expectedSize,
      bytesPerSecond: 0,
    };
    this.send({ status: "downloading", progress: this.lastProgress });

    try {
      await this.performDownload(asset, partPath, finalPath);
    } catch (error) {
      this.state = "idle";
      this.lastProgress = null;
      this.partialPath = null;
      throw error;
    } finally {
      this.activeDownloadKind = null;
    }
  }

  private async tryDifferentialDownload(asset: UpdateAsset): Promise<boolean> {
    if (process.platform !== "win32") return false;
    if (process.env.GUADA_DISABLE_DIFFERENTIAL === "1") return false;

    const feedUrl = deriveGitCodeFeedUrl(asset.url);
    const expectedVersion = String(this.availableInfo?.version || "");
    if (!feedUrl || !expectedVersion) return false;

    const updater = this.getDifferentialUpdater(feedUrl);
    const token = new CancellationToken();
    this.differentialToken = token;
    this.activeDownloadKind = "differential";
    this.state = "downloading";
    this.lastProgress = {
      percent: 0,
      transferred: 0,
      total: Number(asset.size || 0),
      bytesPerSecond: 0,
    };
    this.send({ status: "downloading", progress: this.lastProgress });

    try {
      log.info(`[updater] 尝试差量下载：feed=${feedUrl}`);
      const check = await updater.checkForUpdates();
      if (!check || !check.updateInfo) {
        log.info("[updater] 差量检查未发现可用更新，回退整包下载");
        this.resetDownloadState();
        return false;
      }
      if (String(check.updateInfo.version) !== expectedVersion) {
        log.warn(
          `[updater] latest.yml 版本 ${check.updateInfo.version} 与官网 ${expectedVersion} 不一致，回退整包下载`,
        );
        this.resetDownloadState();
        return false;
      }

      const files = await updater.downloadUpdate(token);
      const filePath = Array.isArray(files) ? files[0] : null;
      if (!filePath || !fs.existsSync(filePath)) {
        log.warn("[updater] 差量下载未返回有效安装包，回退整包下载");
        this.resetDownloadState();
        return false;
      }

      // electron-updater 已按 latest.yml 校验过 sha512；这里再与官网数据交叉校验。
      await this.verifyOfficialHash(filePath, asset.sha512);
      const size = fs.statSync(filePath).size;
      this.completeDownload(filePath, expectedVersion, asset, size);
      return true;
    } catch (error: any) {
      if (this.cancelled || token.cancelled) {
        this.resetDownloadState();
        if (!this.silentAbort) {
          this.send({ status: "available", info: this.availableInfo || {} });
        }
        this.silentAbort = false;
        this.cancelled = false;
        return true;
      }
      if (error instanceof UpdateIntegrityError) {
        this.resetDownloadState();
        throw error;
      }
      log.warn(
        "[updater] 差量下载失败，回退整包下载:",
        error?.message || error,
      );
      this.resetDownloadState();
      return false;
    } finally {
      this.differentialToken = null;
      if (this.activeDownloadKind === "differential") {
        this.activeDownloadKind = null;
      }
    }
  }

  private getDifferentialUpdater(feedUrl: string): NsisUpdater {
    if (!this.differentialUpdater) {
      const updater = new NsisUpdater();
      // electron-updater 默认给 latest.yml 拼 ?noCache=xxx，GitCode 的 release
      // 资源地址带查询参数会直接 404（实测 1.0.7/1.0.8 两次都因此回退整包）。
      // release 目录按版本不可变，不需要缓存穿透，这里强制关闭该参数。
      Object.defineProperty(updater, "isAddNoCacheQuery", {
        configurable: true,
        get: () => false,
      });
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      updater.disableWebInstaller = true;
      updater.disableDifferentialDownload = false;
      updater.logger = {
        info: (...args: any[]) => log.info("[electron-updater]", ...args),
        warn: (...args: any[]) => log.warn("[electron-updater]", ...args),
        error: (...args: any[]) => log.error("[electron-updater]", ...args),
        debug: (...args: any[]) => log.debug("[electron-updater]", ...args),
      };
      // 未打包场景（dev / 本地联调）默认会跳过检查，打开后便于验证。
      if (!app.isPackaged) updater.forceDevUpdateConfig = true;

      updater.on("error", (error: Error) => {
        // 差量流程主要靠 Promise 判定；这里只记录，避免 EventEmitter 的 error 事件未处理。
        log.warn("[updater] electron-updater error:", error?.message || error);
      });
      updater.on("download-progress", (progress: ProgressInfo) => {
        if (this.activeDownloadKind !== "differential") return;
        const now = Date.now();
        if (now - this.lastDifferentialProgressAt < PROGRESS_INTERVAL_MS) {
          return;
        }
        this.lastDifferentialProgressAt = now;
        const total = Number(progress.total || 0);
        const transferred = Number(progress.transferred || 0);
        this.lastProgress = {
          percent:
            total > 0
              ? Math.min(99, Math.round((transferred / total) * 100))
              : Math.max(0, Math.min(99, Math.round(progress.percent || 0))),
          transferred,
          total,
          bytesPerSecond: Math.round(progress.bytesPerSecond || 0),
        };
        this.send({ status: "downloading", progress: this.lastProgress });
      });

      this.differentialUpdater = updater;
    }

    this.differentialUpdater.setFeedURL({
      provider: "generic",
      url: feedUrl,
      // 单 Range 请求兼容性最好（GitCode CDN 与本地 mock 都适用）；
      // 代价是请求数变多，但每次只取缺失的块。
      useMultipleRangeRequest: false,
    });
    return this.differentialUpdater;
  }

  private completeDownload(
    filePath: string,
    version: string,
    asset: UpdateAsset,
    size: number,
  ): void {
    const downloaded: PersistedUpdateState = {
      version,
      filePath,
      sha512: asset.sha512,
      size,
      downloadedAt: Date.now(),
    };
    this.downloaded = downloaded;
    this.persistState(downloaded);
    this.state = "downloaded";
    this.lastProgress = null;
    this.activeDownloadKind = null;
    this.send({
      status: "downloaded",
      version,
      filePath,
      info: this.availableInfo || undefined,
    });
  }

  private async verifyOfficialHash(
    filePath: string,
    expected?: string,
  ): Promise<void> {
    const normalized = String(expected || "")
      .trim()
      .toLowerCase()
      .replace(/^sha512[-:]?/, "");
    if (!normalized) return;

    const hash = crypto.createHash("sha512");
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve());
    });

    const digest = hash.digest();
    const matches =
      normalized === digest.toString("base64").toLowerCase() ||
      normalized === digest.toString("hex").toLowerCase();
    if (!matches) {
      await fs.promises.unlink(filePath).catch(() => undefined);
      throw new UpdateIntegrityError("更新包校验失败：与官网 sha512 不一致");
    }
  }

  private resetDownloadState(): void {
    this.state = "idle";
    this.lastProgress = null;
    this.activeDownloadKind = null;
  }

  private pickAsset(info: UpdateInfo): UpdateAsset | null {
    if (process.platform !== "win32") return null;
    const asset = info.downloads?.win;
    if (!asset || typeof asset.url !== "string" || !asset.url) return null;
    return asset;
  }

  private async assertDiskSpace(dir: string, expectedSize: number): Promise<void> {
    if (!expectedSize) return;
    try {
      const stats = await fs.promises.statfs(dir);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (free > 0 && free < expectedSize + MIN_FREE_SPACE_MARGIN) {
        throw new Error(
          `磁盘空间不足：需要约 ${this.formatBytes(expectedSize + MIN_FREE_SPACE_MARGIN)}，当前可用 ${this.formatBytes(free)}`,
        );
      }
    } catch (error: any) {
      // statfs 在个别文件系统上不可用；只有明确的“空间不足”才中断。
      if (String(error?.message || "").includes("磁盘空间不足")) throw error;
      log.warn("[updater] 无法检查磁盘空间，继续下载:", error?.message || error);
    }
  }

  private performDownload(
    asset: UpdateAsset,
    partPath: string,
    finalPath: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let transferred = 0;
      let total = Number(asset.size || 0);
      let startedAt = Date.now();
      let lastProgressAt = 0;
      const hash = crypto.createHash("sha512");
      const expectedSha512 = String(asset.sha512 || "").trim().toLowerCase();

      const clearStallTimer = () => {
        if (this.stallTimer) {
          clearTimeout(this.stallTimer);
          this.stallTimer = null;
        }
      };

      const closeResources = () => {
        clearStallTimer();
        try {
          // Electron 的 IncomingMessage 类型未声明 destroy，但运行时是 Readable。
          (this.response as unknown as { destroy?: () => void })?.destroy?.();
        } catch {
          // ignore
        }
        try {
          this.stream?.destroy();
        } catch {
          // ignore
        }
        this.response = null;
        this.stream = null;
        this.request = null;
      };

      const cleanupPartial = () => {
        void fs.promises.unlink(partPath).catch(() => undefined);
        if (this.partialPath === partPath) this.partialPath = null;
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        closeResources();
        this.cancelDownload = null;
        cleanupPartial();

        if (this.cancelled) {
          this.state = "idle";
          this.lastProgress = null;
          this.cancelled = false;
          if (!this.silentAbort) {
            this.send({
              status: "available",
              info: this.availableInfo || {},
            });
          }
          this.silentAbort = false;
          resolve();
          return;
        }

        reject(error);
      };

      const succeed = async () => {
        if (settled) return;
        settled = true;
        clearStallTimer();
        this.cancelDownload = null;

        try {
          const digest = hash.digest();
          const actualBase64 = digest.toString("base64").toLowerCase();
          const actualHex = digest.toString("hex").toLowerCase();
          const expected = expectedSha512.replace(/^sha512[-:]?/, "");
          if (expected && expected !== actualBase64 && expected !== actualHex) {
            throw new Error("更新包校验失败，请重试或手动下载");
          }
          if (asset.size && transferred !== Number(asset.size)) {
            throw new Error(
              `更新包大小不一致（期望 ${asset.size} 字节，实际 ${transferred} 字节）`,
            );
          }

          await fs.promises.rename(partPath, finalPath);
          this.partialPath = null;
          this.completeDownload(
            finalPath,
            String(this.availableInfo?.version || "unknown"),
            asset,
            transferred,
          );
          resolve();
        } catch (error: any) {
          closeResources();
          cleanupPartial();
          this.state = "idle";
          this.lastProgress = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      const resetStallTimer = () => {
        clearStallTimer();
        this.stallTimer = setTimeout(() => {
          fail(new Error("下载超时：长时间未收到数据，请重试"));
        }, STALL_TIMEOUT_MS);
      };

      const reportProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return;
        lastProgressAt = now;
        const elapsedSeconds = Math.max(1, (now - startedAt) / 1000);
        const percent =
          total > 0
            ? Math.min(99, Math.round((transferred / total) * 100))
            : 0;
        this.lastProgress = {
          percent,
          transferred,
          total,
          bytesPerSecond: Math.round(transferred / elapsedSeconds),
        };
        this.send({ status: "downloading", progress: this.lastProgress });
      };

      this.cancelDownload = () => fail(new Error("已取消下载"));
      resetStallTimer();

      const request = net.request({
        method: "GET",
        url: asset.url,
        redirect: "follow",
      });
      this.request = request;

      request.on("response", (response) => {
        this.response = response;
        resetStallTimer();

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          fail(new Error(`下载失败：HTTP ${response.statusCode}`));
          return;
        }

        const rawLength = response.headers["content-length"];
        const contentLength = Number(
          Array.isArray(rawLength) ? rawLength[0] : rawLength,
        );
        if (contentLength > 0) total = contentLength;
        if (!total && asset.size) total = Number(asset.size);
        startedAt = Date.now();
        reportProgress(true);

        const stream = fs.createWriteStream(partPath);
        this.stream = stream;
        stream.on("error", (error) => fail(error));

        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          resetStallTimer();
          transferred += chunk.length;
          hash.update(chunk);

          if (!stream.write(chunk)) {
            // Electron 的 IncomingMessage 运行时实现了 Readable，但类型定义未暴露。
            const readable = response as unknown as NodeJS.ReadableStream;
            readable.pause();
            stream.once("drain", () => {
              if (!settled) readable.resume();
            });
          }
          reportProgress();
        });

        response.on("end", () => {
          if (settled) return;
          reportProgress(true);
          stream.end(() => {
            void succeed();
          });
        });

        response.on("error", (error) => fail(error));
      });

      request.on("error", (error) => fail(error));
      request.end();
    });
  }

  private safeFileName(fileName: string | undefined, url: string): string {
    let candidate = fileName || "";
    if (!candidate) {
      try {
        candidate = decodeURIComponent(
          new URL(url).pathname.split("/").pop() || "",
        );
      } catch {
        candidate = "";
      }
    }
    const base = path.basename(candidate || "GuaDa-Setup.exe");
    const sanitized = base.replace(/[\\/:*?"<>|]/g, "_").trim();
    return sanitized || "GuaDa-Setup.exe";
  }

  private statePath(): string {
    return path.join(app.getPath("userData"), STATE_FILE_NAME);
  }

  private loadPersistedState(): PersistedUpdateState | null {
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.statePath(), "utf8"),
      ) as PersistedUpdateState;
      if (!raw?.filePath || !raw?.version) return null;
      if (!fs.existsSync(raw.filePath)) {
        this.clearPersistedState();
        return null;
      }
      // 已经装上或超过当前版本的安装包没有保留价值：删除旧包。
      if (compareVersions(raw.version, app.getVersion()) <= 0) {
        try {
          fs.unlinkSync(raw.filePath);
        } catch {
          // ignore
        }
        this.clearPersistedState();
        return null;
      }
      return raw;
    } catch {
      return null;
    }
  }

  private persistState(state: PersistedUpdateState): void {
    try {
      fs.writeFileSync(this.statePath(), JSON.stringify(state), "utf8");
    } catch (error: any) {
      log.warn("[updater] 写入更新状态失败:", error?.message || error);
    }
  }

  private clearPersistedState(): void {
    try {
      fs.unlinkSync(this.statePath());
    } catch {
      // ignore
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${Math.round(bytes / (1024 * 1024))} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
}
