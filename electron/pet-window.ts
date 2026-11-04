/**
 * 桌面宠物窗口（替代旧的「托盘悬浮任务状态卡」）。
 *
 * 设计要点：
 * - 透明、无边框、置顶、不占任务栏、**不可聚焦**（focusable:false）——
 *   点宠物不该抢走主窗口的输入焦点；
 * - 整窗默认鼠标穿透（setIgnoreMouseEvents(true, { forward: true })），
 *   由主进程按 40ms 轮询光标位置 + 渲染层上报的命中矩形决定何时放开，
 *   而不是依赖渲染层的 mousemove：窗口一旦穿透，渲染层就收不到 mousemove，
 *   靠事件驱动会陷入「穿透后再也回不来」的死循环；
 * - 拖动不用 `-webkit-app-region: drag`（会吞掉渲染层的鼠标事件、且无法区分点击），
 *   改为渲染层上报 screen 增量 → 主进程 setPosition；
 * - 拖动期间暂停命中判定：窗口在光标下移动，若恰好一瞬间判到窗外就会穿透，
 *   渲染层随即丢失 mousemove，拖动中途卡死；
 * - 位置持久化到 userData/pet-window.json，多屏/拔屏后夹回最近的显示器可视区。
 *
 * 本模块只负责窗口生命周期与穿透，业务状态（运行中/未读/标题）由 main.ts 转发。
 */
import { BrowserWindow, screen, type Display } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";

/**
 * 窗口逻辑尺寸（DIP）。
 * 宽度取 360 而不是「气泡宽 250」：宠物贴边时窗口会有一截在屏幕外，
 * 气泡要往左让，必须留出这段余量，否则贴边后气泡会被压到读不清。
 * 高度 = 宠物 216 + 气泡 ~60 + 余量。
 */
export const PET_WINDOW_WIDTH = 360;
export const PET_WINDOW_HEIGHT = 300;
/** 命中判定轮询间隔：40ms ≈ 25Hz，肉眼无延迟且开销可忽略 */
export const PET_HIT_POLL_MS = 40;

/** 窗口内坐标矩形（CSS px，与 DIP 同尺度：zoomFactor 恒为 1） */
export interface PetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 渲染层上报的可交互几何（窗口内坐标）。
 * image 是「当前动画的紧包围盒」而非整张画布：立绘四周大片透明，
 * 用画布矩形会挡住桌面点击；气泡可为空 = 当前收起。
 */
export interface PetHitGeometry {
  image: PetRect;
  bubble: PetRect | null;
}

/** 屏幕坐标点 / 窗口矩形（均为 DIP） */
export interface PetPoint {
  x: number;
  y: number;
}

export interface PetWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 默认形象 id（唯一内置形象；用户未选择时用它） */
export const PET_AVATAR_DEFAULT = "silver-haired";

/** 形象目录名白名单：只允许简单标识符，杜绝 ../ 之类的路径穿越 */
export function isValidAvatarId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/**
 * 形象根目录（内含多个 <id>/ 子目录，每个是一套形象）。
 * - dev：electron/dist/pet-window.js → 向上两级 = 项目根 → build-resources/pets
 * - 生产：resources/build-resources/pets（electron-builder 整包拷 build-resources）
 */
export function resolvePetsRootDir(
  isDev: boolean,
  moduleDir: string,
  resourcesPath: string,
): string {
  return isDev
    ? path.join(moduleDir, "..", "..", "build-resources", "pets")
    : path.join(resourcesPath, "build-resources", "pets");
}

/** 某个形象的素材目录 */
export function resolvePetAssetDir(petsRootDir: string, avatarId: string): string {
  return path.join(petsRootDir, isValidAvatarId(avatarId) ? avatarId : PET_AVATAR_DEFAULT);
}

/** 设置页形象选择器需要的条目 */
export interface PetAvatarInfo {
  id: string;
  name: string;
  /** 预览图 data URL（dev 走 http、prod 走 file://，只有 data URL 两边都通用） */
  previewDataUrl: string | null;
}

/**
 * 扫描形象目录，供设置页展示可选形象。
 * 只认「有 sprites.json 的子目录」，坏目录直接跳过，不让设置页崩掉。
 */
export function listPetAvatars(petsRootDir: string): PetAvatarInfo[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(petsRootDir, { withFileTypes: true });
  } catch (error) {
    log.warn("[pet] 读取形象目录失败:", error);
    return [];
  }

  const list: PetAvatarInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidAvatarId(entry.name)) continue;
    const dir = path.join(petsRootDir, entry.name);
    const configPath = path.join(dir, "sprites.json");
    if (!fs.existsSync(configPath)) continue;

    let name = entry.name;
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        name?: unknown;
      };
      if (typeof config.name === "string" && config.name.trim()) {
        name = config.name.trim();
      }
    } catch (error) {
      log.warn(`[pet] 形象 ${entry.name} 的 sprites.json 解析失败:`, error);
    }

    let previewDataUrl: string | null = null;
    const avatarPath = path.join(dir, "avatar.webp");
    if (fs.existsSync(avatarPath)) {
      try {
        previewDataUrl = `data:image/webp;base64,${fs
          .readFileSync(avatarPath)
          .toString("base64")}`;
      } catch (error) {
        log.warn(`[pet] 形象 ${entry.name} 的预览图读取失败:`, error);
      }
    }

    list.push({ id: entry.name, name, previewDataUrl });
  }

  // 默认形象排最前，其余按 id 稳定排序
  list.sort((a, b) => {
    if (a.id === PET_AVATAR_DEFAULT) return -1;
    if (b.id === PET_AVATAR_DEFAULT) return 1;
    return a.id.localeCompare(b.id);
  });
  return list;
}

/** 点是否落在矩形内（半开区间，右/下边界不算命中） */
export function pointInRect(point: PetPoint, rect: PetRect): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.w &&
    point.y >= rect.y &&
    point.y < rect.y + rect.h
  );
}

/**
 * 光标是否可交互（决定放开/恢复穿透）。
 *
 * 判定顺序：气泡矩形 → 宠物紧包围盒 → 其余穿透。
 * image 用的是「当前动画的包围盒」而不是整张画布：立绘四周（以及换动画时
 * 手臂张开多出来的那圈）大片透明，用画布矩形会挡住桌面点击。
 */
export function resolvePetHit(
  cursor: PetPoint,
  bounds: PetWindowBounds,
  geometry: PetHitGeometry | null,
): boolean {
  if (!geometry) return false;
  const local: PetPoint = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  if (geometry.bubble && pointInRect(local, geometry.bubble)) return true;
  return pointInRect(local, geometry.image);
}

/**
 * 数值夹取。
 * 区间上下界可能反转（内容比工作区还宽时），此时取下界，保证至少左边/上边可见。
 */
export function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 把宠物窗口位置夹进可视工作区。
 *
 * 只保证「左上角在某个显示器内 + 整窗不越过该显示器右下边界」——
 * 用户把宠物拖到屏幕边缘是合理诉求，不强行居中；
 * 副屏被拔掉后旧坐标会落在虚空，此时回落到主屏默认位置。
 */
export function clampPetPosition(
  position: PetPoint,
  workArea: PetWorkArea,
  size: { width: number; height: number },
): PetPoint {
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);
  return {
    x: Math.min(Math.max(position.x, workArea.x), maxX),
    y: Math.min(Math.max(position.y, workArea.y), maxY),
  };
}

/** 默认落点：右下角，留 24px 边距（任务栏侧不贴边） */
export function defaultPetPosition(
  workArea: PetWorkArea,
  size: { width: number; height: number },
): PetPoint {
  return {
    x: workArea.x + workArea.width - size.width - 24,
    y: workArea.y + workArea.height - size.height - 24,
  };
}

/** 找到包含给定点的显示器（找不到回主屏） */
export function findDisplayForPoint(
  point: PetPoint,
  displays: readonly Display[],
): Display | undefined {
  return displays.find((d) => {
    const b = d.bounds;
    return (
      point.x >= b.x &&
      point.x < b.x + b.width &&
      point.y >= b.y &&
      point.y < b.y + b.height
    );
  });
}

export interface PetPositionFile {
  x: number;
  y: number;
  /**
   * 立绘在窗口内的矩形（可选）。
   * 贴边时窗口允许溢出屏幕，只靠 x/y 无法判断「立绘是否可见」；
   * 存下它，重启后才能按同样的规则恢复贴边位置，而不是被整窗夹回屏幕内。
   */
  box?: { x: number; y: number; w: number; h: number };
}

function readOptionalBox(value: unknown): PetPositionFile["box"] {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const x = rec.x;
  const y = rec.y;
  const w = rec.w;
  const h = rec.h;
  if (
    typeof x !== "number" || !Number.isFinite(x) ||
    typeof y !== "number" || !Number.isFinite(y) ||
    typeof w !== "number" || !Number.isFinite(w) || w <= 0 ||
    typeof h !== "number" || !Number.isFinite(h) || h <= 0
  ) {
    return undefined;
  }
  return { x, y, w, h };
}

/** 读位置文件；任何异常（不存在/损坏/字段非法）都返回 null，交给默认落点 */
export function readPetPositionFile(file: string): PetPositionFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    const x = rec.x;
    const y = rec.y;
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const box = readOptionalBox(rec.box);
    return box ? { x, y, box } : { x, y };
  } catch {
    return null;
  }
}

/** 写位置文件（尽力而为，失败只记日志：位置记忆不是功能前提） */
export function writePetPositionFile(file: string, position: PetPositionFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(position), "utf8");
  } catch (error) {
    log.warn("[pet] 保存窗口位置失败:", error);
  }
}

export interface PetWindowOptions {
  /** 形象根目录（内含多个 <id>/ 形象目录） */
  petsRootDir: string;
  /** 初始形象 id */
  avatarId?: string;
  /** pet-preload.js 绝对路径 */
  preloadPath: string;
  /** 位置记忆文件绝对路径 */
  positionFile: string;
}

/** 主进程 → 桌宠的状态载荷 */
export interface PetStatePayload {
  mode: "idle" | "walk" | "run" | "yawn";
  running: number;
  unread: number;
  title?: string;
  toolLabel?: string;
  sessionId?: string | null;
}

export class PetWindowController {
  private win: BrowserWindow | null = null;
  private readonly options: PetWindowOptions;

  /** 渲染层上报的可交互几何（窗口内坐标） */
  private geometry: PetHitGeometry | null = null;
  /** 当前是否已置为穿透（避免每 40ms 重复调用 setIgnoreMouseEvents） */
  private appliedIgnore: boolean | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  /** 拖动/按钮交互中：暂停命中判定，保持可交互 */
  private interacting = false;
  /** 当前是否应当显示（由设置开关驱动） */
  private enabled = false;
  private opacity = 95;
  private lastState: PetStatePayload | null = null;
  private configJson: string | null = null;
  /** 当前形象 id（切换形象会重建窗口，因为素材目录整体换了） */
  private avatarId: string;

  constructor(options: PetWindowOptions) {
    this.options = options;
    this.avatarId = isValidAvatarId(options.avatarId ?? "")
      ? (options.avatarId as string)
      : PET_AVATAR_DEFAULT;
  }

  /** 当前形象的素材目录 */
  private get assetDir(): string {
    return resolvePetAssetDir(this.options.petsRootDir, this.avatarId);
  }

  /** 当前形象 id（设置页回显用） */
  getAvatarId(): string {
    return this.avatarId;
  }

  /**
   * 切换形象。素材目录整体更换，只能重建窗口；
   * 位置/开关/透明度都是控制器自己的状态，重建后自动沿用。
   */
  setAvatar(avatarId: string): void {
    const next = isValidAvatarId(avatarId) ? avatarId : PET_AVATAR_DEFAULT;
    if (next === this.avatarId) return;
    this.avatarId = next;
    // 配置随素材变，必须失效重读
    this.configJson = null;
    this.geometry = null;
    if (!this.isAlive()) return;

    const old = this.win;
    const wasEnabled = this.enabled;
    // 先摘引用再建新窗，最后销毁旧窗：中间不能出现「零窗口」瞬间，
    // 否则会触发 window-all-closed（桌面端虽因主窗存在而不致命，
    // 但独立运行时应用会直接退出），也会让旧窗的 closed 回调干扰新窗。
    this.win = null;
    this.stopPoll();
    if (wasEnabled) this.setEnabled(true);
    if (old && !old.isDestroyed()) old.destroy();
  }

  get window(): BrowserWindow | null {
    return this.win;
  }

  /** 窗口是否已创建且未销毁 */
  isAlive(): boolean {
    return Boolean(this.win && !this.win.isDestroyed());
  }

  /**
   * 确保窗口存在（懒创建：用户没开桌宠就完全不占内存/GPU）。
   * 返回是否创建成功——素材缺失时直接失败，不要留下一个白框。
   */
  ensureWindow(): BrowserWindow | null {
    if (this.isAlive()) return this.win;

    const htmlPath = path.join(this.assetDir, "pet.html");
    if (!fs.existsSync(htmlPath)) {
      log.warn(`[pet] 素材缺失，跳过创建: ${htmlPath}`);
      return null;
    }

    const position = this.resolveInitialPosition();
    const win = new BrowserWindow({
      width: PET_WINDOW_WIDTH,
      height: PET_WINDOW_HEIGHT,
      x: position.x,
      y: position.y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      focusable: false,
      show: false,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 桌宠是低频动画，后台节流会让切到别的应用后动画停住、气泡不刷新
        backgroundThrottling: false,
      },
    });

    // 悬浮于全屏应用之上（macOS 需要显式声明；Windows 靠 alwaysOnTop 的 screen-saver 层级）
    win.setAlwaysOnTop(true, "screen-saver");
    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    win.on("closed", () => {
      // 身份判断：切换形象时是「先销毁旧窗、再建新窗」，
      // 旧窗的 closed 可能晚于新窗创建才回调，无脑置 null 会把新窗引用抹掉
      // （表现为新形象加载失败、穿透轮询被停）。
      if (this.win !== win) return;
      this.win = null;
      this.stopPoll();
    });

    // 首帧就绪前保持穿透，避免加载期挡住桌面点击
    win.setIgnoreMouseEvents(true, { forward: true });
    this.appliedIgnore = true;

    void win.loadFile(htmlPath).catch((error) => {
      log.warn("[pet] 加载页面失败:", error);
    });

    this.win = win;
    this.startPoll();
    log.info(
      `[pet] 桌宠窗口已创建 pos=(${position.x},${position.y}) size=${PET_WINDOW_WIDTH}x${PET_WINDOW_HEIGHT}`,
    );
    return win;
  }

  /** 依据位置文件 + 显示器工作区决定初始坐标 */
  private resolveInitialPosition(): PetPoint {
    const size = { width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT };
    const saved = readPetPositionFile(this.options.positionFile);
    if (saved) {
      const display = findDisplayForPoint(saved, screen.getAllDisplays());
      if (display) {
        const area = display.workArea;
        // 有立绘矩形 → 按它恢复（贴边时窗口本来就在屏幕外，不能按整窗夹）
        if (saved.box) {
          const box = saved.box;
          return {
            x: clampNumber(saved.x, area.x - box.x, area.x + area.width - (box.x + box.w)),
            y: clampNumber(saved.y, area.y - box.y, area.y + area.height - (box.y + box.h)),
          };
        }
        return clampPetPosition(saved, area, size);
      }
      // 保存点在所有显示器之外（拔了副屏）→ 回落主屏
    }
    const primary = screen.getPrimaryDisplay();
    return defaultPetPosition(primary.workArea, size);
  }

  /** 设置开关：enabled=false 时隐藏窗口（保留实例，下次开关秒开） */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
      return;
    }
    const win = this.ensureWindow();
    if (!win) return;
    if (!win.isVisible()) {
      win.showInactive();
      // 重新显示后强制重新判定一次穿透
      this.appliedIgnore = null;
      this.startPoll();
      this.pushClip();
    }
    this.pushSettings();
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
    this.pushSettings();
  }

  /** 是否处于「应显示」状态（托盘菜单勾选态） */
  isEnabled(): boolean {
    return this.enabled;
  }

  show(): void {
    const win = this.ensureWindow();
    if (!win || win.isVisible()) return;
    win.showInactive();
    this.appliedIgnore = null;
    this.startPoll();
  }

  hide(): void {
    if (!this.isAlive()) return;
    this.win?.hide();
    this.stopPoll();
    this.appliedIgnore = null;
  }

  /** 主进程 → 渲染层：状态（模式/计数/标题/工具名） */
  pushState(state: PetStatePayload): void {
    this.lastState = state;
    this.send("pet:state", state);
  }

  /** 主进程 → 渲染层：透明度 */
  pushSettings(): void {
    this.send("pet:settings", { opacity: this.opacity });
  }

  /** 主进程 → 渲染层：动画清单（file:// 下渲染层 fetch 会被拦，统一由主进程读盘下发） */
  pushConfig(): void {
    if (this.configJson === null) {
      const configPath = path.join(this.assetDir, "sprites.json");
      try {
        this.configJson = fs.readFileSync(configPath, "utf8");
      } catch (error) {
        log.warn("[pet] 读取 sprites.json 失败:", error);
        return;
      }
    }
    this.sendRaw("pet:config", this.configJson);
  }

  /** 渲染层首帧就绪：补发全部缓存状态 */
  onRendererReady(): void {
    this.pushConfig();
    this.pushSettings();
    // 首帧就发一次可见区间：窗口可能是从上次贴边位置恢复的，
    // 渲染层据此把气泡偏到屏幕内
    this.pushClip();
    if (this.lastState) this.pushState(this.lastState);
  }

  /** 渲染层上报命中几何（图片矩形 + 气泡矩形） */
  setHitGeometry(geometry: PetHitGeometry | null): void {
    const valid = (r: PetRect | null | undefined): r is PetRect =>
      Boolean(
        r &&
          Number.isFinite(r.x) &&
          Number.isFinite(r.y) &&
          Number.isFinite(r.w) &&
          Number.isFinite(r.h) &&
          r.w > 0 &&
          r.h > 0,
      );
    this.geometry =
      geometry && valid(geometry.image)
        ? {
            image: {
              x: geometry.image.x,
              y: geometry.image.y,
              w: geometry.image.w,
              h: geometry.image.h,
            },
            bubble: valid(geometry.bubble) ? { ...geometry.bubble } : null,
          }
        : null;
    // 立即判定一次，避免光标已在宠物身上却要等下一拍才可点
    this.tick();
  }

  setInteracting(interacting: boolean): void {
    this.interacting = interacting;
    if (interacting) this.applyIgnore(false);
  }

  /** 按屏幕增量移动窗口（渲染层拖拽） */
  moveBy(dx: number, dy: number): void {
    if (!this.isAlive()) return;
    const win = this.win!;
    const [x, y] = win.getPosition();
    win.setPosition(x + Math.round(dx), y + Math.round(dy));
  }

  /** 拖动结束：落盘位置（夹回当前显示器可视区，防止拖出屏幕再也点不到） */
  /**
   * 拖动结束：落盘位置，并把**立绘**夹回可视区。
   *
   * 为什么按立绘夹：窗口 280px 宽，而立绘只占中间一条（idle 约 65px），
   * 按窗口夹会让宠物永远离屏幕边缘约 100px，拖到边上会「弹回来」。
   * 允许窗口本体溢出屏幕，宠物才能真的贴边。
   *
   * 气泡不参与夹取：它比宠物宽，若也参与，宠物就永远贴不到边。
   * 气泡改为「按屏幕可见区在窗口内横向偏移」（见 pushClip / pet.html）。
   */
  persistPosition(): void {
    if (!this.isAlive()) return;
    const next = this.clampIntoView({ includeBubble: false });
    this.pushClip();
    // 落盘时额外记下「立绘矩形」：重启恢复贴边要用它。
    const box = this.visualBox(false);
    writePetPositionFile(this.options.positionFile, {
      x: next.x,
      y: next.y,
      ...(box
        ? {
            box: {
              x: box.left,
              y: box.top,
              w: box.right - box.left,
              h: box.bottom - box.top,
            },
          }
        : {}),
    });
  }

  /**
   * 把窗口在屏幕上的可见区间（窗口内坐标）告诉渲染层，
   * 让气泡自己横向偏移，而不是把窗口推回屏幕内。
   */
  pushClip(): void {
    if (!this.isAlive()) return;
    const win = this.win!;
    const [x] = win.getPosition();
    const area = this.currentWorkArea();
    const left = Math.max(0, Math.min(PET_WINDOW_WIDTH, area.x - x));
    const right = Math.min(
      PET_WINDOW_WIDTH,
      Math.max(0, area.x + area.width - x),
    );
    this.send("pet:clip", { left, right });
  }

  /**
   * 把窗口位置夹到「可见内容不出屏」的范围内。
   *
   * includeBubble=true 时用「立绘 ∪ 气泡」的包围盒，false 时只用立绘。
   * 没有几何信息（首帧未上报）时退化为整窗夹取。
   */
  private clampIntoView(options: { includeBubble: boolean }): PetPositionFile {
    const win = this.win!;
    const [x, y] = win.getPosition();
    const area = this.currentWorkArea();
    const box = this.visualBox(options.includeBubble);

    let nextX = x;
    let nextY = y;
    if (box) {
      // 窗口可以溢出，只要「内容矩形」留在工作区内
      nextX = clampNumber(x, area.x - box.left, area.x + area.width - box.right);
      nextY = clampNumber(y, area.y - box.top, area.y + area.height - box.bottom);
    } else {
      const clamped = clampPetPosition(
        { x, y },
        area,
        { width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT },
      );
      nextX = clamped.x;
      nextY = clamped.y;
    }

    if (nextX !== x || nextY !== y) win.setPosition(nextX, nextY);
    return { x: nextX, y: nextY };
  }

  /** 立绘（可含气泡）在窗口内的包围盒；无几何信息返回 null */
  private visualBox(
    includeBubble: boolean,
  ): { left: number; top: number; right: number; bottom: number } | null {
    const g = this.geometry;
    if (!g) return null;
    let left = g.image.x;
    let top = g.image.y;
    let right = g.image.x + g.image.w;
    let bottom = g.image.y + g.image.h;
    if (includeBubble && g.bubble) {
      left = Math.min(left, g.bubble.x);
      top = Math.min(top, g.bubble.y);
      right = Math.max(right, g.bubble.x + g.bubble.w);
      bottom = Math.max(bottom, g.bubble.y + g.bubble.h);
    }
    return { left, top, right, bottom };
  }

  /** 当前窗口中心所在显示器的工作区（拔屏/跨屏拖动都按中心判） */
  private currentWorkArea(): PetWorkArea {
    const win = this.win!;
    const [x, y] = win.getPosition();
    const display = findDisplayForPoint(
      { x: x + PET_WINDOW_WIDTH / 2, y: y + PET_WINDOW_HEIGHT / 2 },
      screen.getAllDisplays(),
    );
    return (display ?? screen.getPrimaryDisplay()).workArea;
  }

  destroy(): void {
    this.stopPoll();
    if (!this.isAlive()) return;
    this.win?.destroy();
    this.win = null;
  }

  // ── 穿透判定 ────────────────────────────────────────────────

  private startPoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.tick(), PET_HIT_POLL_MS);
    // 轮询不该阻止进程退出
    this.pollTimer.unref?.();
  }

  private stopPoll(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private tick(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (this.interacting) {
      this.applyIgnore(false);
      return;
    }
    // 还没收到几何（首帧未就绪）→ 保持穿透，避免整窗挡住桌面
    if (!this.geometry) {
      this.applyIgnore(true);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const hit = resolvePetHit(cursor, win.getBounds(), this.geometry);
    this.applyIgnore(!hit);
  }

  private applyIgnore(ignore: boolean): void {
    if (this.appliedIgnore === ignore) return;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    this.appliedIgnore = ignore;
    win.setIgnoreMouseEvents(ignore, { forward: true });
  }

  /**
   * 发消息给渲染层。
   * 不按可见性过滤：首帧就绪（pet:ready）时窗口通常还没 show，
   * 过滤会让配置/状态永远送不进去；隐藏期间发送无害（渲染层缓存即可）。
   */
  private send(channel: string, payload: unknown): void {
    if (!this.isAlive()) return;
    this.win!.webContents.send(channel, payload);
  }

  private sendRaw(channel: string, json: string): void {
    if (!this.isAlive()) return;
    this.win!.webContents.send(channel, json);
  }
}
