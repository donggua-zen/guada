/**
 * 亚像素自检（仅开发环境）
 *
 * 用途：布局稳定后扫描 DOM，报告哪些元素的几何量（left/top/width/height）带小数。
 * 小数几何是"文字发虚 / 图标跳一个设备像素"的根因，肉眼在 100% 缩放下经常看不出来
 * （尤其在 125% / 150% 系统缩放会放大成 1px 抖动与模糊），所以用一次性扫描代替肉眼排查。
 *
 * 用法：dev 启动后，控制台执行 `__subpixelAudit()`（或 `__subpixelAudit({ all: true })`）。
 * 扫描会跳过动画中/带 transform 的元素（它们的中间态本来就是小数，不算问题），
 * 以及 display:none / visibility:hidden / 零尺寸的元素。
 *
 * 注意：getBoundingClientRect 的返回值本身有浮点噪声（例如 743.9999999999999），
 * 判定阈值取 1e-3，避免把整数误报成小数。
 */

/** 允许的浮点噪声 */
const EPS = 1e-3;

export interface SubpixelOffender {
  /** 最近的 Vue 组件名（dev 构建下从 __vueParentComponent 取） */
  component: string;
  /** 元素标签 + class，便于定位 */
  where: string;
  /** 带小数的量及其小数部分（如 top: 0.5） */
  fracs: string[];
  rect: { left: number; top: number; width: number; height: number };
}

export interface SubpixelAuditOptions {
  /** 扫描根，默认 #app */
  root?: HTMLElement | null;
  /** 是否连动画中/带 transform 的元素一起报告（默认 false） */
  all?: boolean;
  /** 报告上限（默认 60），超出只统计不逐个打印 */
  limit?: number;
}

function componentNameOf(el: Element): string {
  let node: Element | null = el;
  while (node) {
    const inst = (node as unknown as { __vueParentComponent?: { type?: Record<string, unknown> } })
      .__vueParentComponent;
    const type = inst?.type;
    const name = (type?.__name ?? type?.name) as string | undefined;
    if (name) return name;
    node = node.parentElement;
  }
  return "(未知组件)";
}

/** 矩阵的 2D 线性部分是否为恒等（即"只平移不缩放/旋转/斜切"） */
function isTranslationOnly(transform: string): boolean {
  if (transform === "none") return true;
  const nums = transform.match(/-?[\d.]+(?:e[-+]?\d+)?/g);
  if (!nums) return false;
  const v = nums.map(Number);
  if (transform.startsWith("matrix(")) {
    const [a, b, c, d] = v;
    return a === 1 && b === 0 && c === 0 && d === 1;
  }
  if (transform.startsWith("matrix3d(")) {
    const [a, b, c, d] = v;
    return a === 1 && b === 0 && c === 0 && d === 1;
  }
  return false;
}

/** 纯合成层提升（translateZ(0)）算成恒等矩阵，不代表几何位移 */
const IDENTITY_TRANSFORMS = new Set([
  "matrix(1, 0, 0, 1, 0, 0)",
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)",
]);

/** 单次扫描内的"是否在动"缓存：祖先链逐层回查会退化成 O(n·depth)，对话流有上万节点 */
type MovingCache = WeakMap<Element, boolean>;

/**
 * 元素自身或祖先在动（跑动画/过渡）或带缩放/旋转类 transform → 中间态小数不算问题。
 * 三个实测踩过的点：
 * - 只豁免纯平移：对话滚动容器挂着 translateZ(0)（计算值 matrix(1,0,0,1,0,0)，不是 matrix3d），
 *   若按"有 transform 就跳过"会整片跳过对话流；
 * - 平移（如确定性吸附写的 translateX(0.5px)）不能跳过整棵子树：子元素量到的
 *   rect 已含该平移，其小数是"吸附后仍存在"的真实小数，必须报；
 * - 必须缓存：上万节点逐个回查祖先链会慢到让扫描超时。
 */
function isMoving(el: Element, root: HTMLElement | null, cache: MovingCache): boolean {
  const cached = cache.get(el);
  if (cached !== undefined) return cached;

  const self =
    (typeof (el as HTMLElement).getAnimations === "function"
      && (el as HTMLElement).getAnimations({ subtree: false }).length > 0)
    || (() => {
      const transform = getComputedStyle(el).transform;
      return !IDENTITY_TRANSFORMS.has(transform) && !isTranslationOnly(transform);
    })();

  const parent = el.parentElement;
  const result = self || (parent && parent !== root && parent !== document.body
    ? isMoving(parent, root, cache)
    : false);

  cache.set(el, result);
  return result;
}

/**
 * SVG 子元素（g / path / rect…）的盒是"图形包围盒"，坐标由图标缩放（viewBox → 显示尺寸）
 * 算出来，天生带小数，属正常矢量渲染，不是布局亚像素问题。
 * 只跳过 svg 的后代，svg 根元素本身要留着——它的尺寸就是图标尺寸（奇数图标盒正在此暴露）。
 */
function isSvgInternal(el: Element): boolean {
  return el.tagName.toLowerCase() !== "svg" && el.closest("svg") !== null;
}

function fracOf(value: number): number | null {
  const frac = value - Math.floor(value);
  if (frac < EPS || frac > 1 - EPS) return null;
  return frac;
}

/** 扫描并返回带小数几何的元素清单 */
export function scanSubpixel(opts: SubpixelAuditOptions = {}): SubpixelOffender[] {
  const root = opts.root ?? (document.querySelector("#app") as HTMLElement | null);
  if (!root) {
    console.warn("[subpixel] 找不到扫描根");
    return [];
  }

  const out: SubpixelOffender[] = [];
  const nodes = root.querySelectorAll<HTMLElement>("*");
  const movingCache: MovingCache = new WeakMap();

  for (const el of nodes) {
    if (el.getClientRects().length === 0) continue; // display:none / 无盒
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "contents") continue;
    if (isSvgInternal(el)) continue;
    if (!opts.all && isMoving(el, root, movingCache)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const fracs: string[] = [];
    (["left", "top", "width", "height"] as const).forEach((key) => {
      const frac = fracOf(rect[key]);
      if (frac !== null) fracs.push(`${key}=${rect[key].toFixed(2)}(+${frac.toFixed(2)})`);
    });
    if (fracs.length === 0) continue;

    const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    out.push({
      component: componentNameOf(el),
      where: `${el.tagName.toLowerCase()}${classes ? `.${classes}` : ""}`,
      fracs,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  }

  return out;
}

/** 按组件分组打印扫描结果 */
export function reportSubpixel(opts: SubpixelAuditOptions = {}): SubpixelOffender[] {
  const limit = opts.limit ?? 60;
  const list = scanSubpixel(opts);
  if (list.length === 0) {
    console.log(
      `%c[subpixel] 未发现小数几何${opts.all ? "" : "（动画中/带 transform 的元素已跳过，加 { all: true } 可一并查看）"}`,
      "color:#10b981",
    );
    return list;
  }

  console.group(
    `%c[subpixel] ${list.length} 处小数几何${list.length > limit ? `（只打印前 ${limit} 条）` : ""}`,
    "color:#f59e0b;font-weight:600",
  );
  console.table(
    list.slice(0, limit).map((item) => ({
      组件: item.component,
      元素: item.where,
      小数: item.fracs.join(" "),
    })),
  );
  const byComponent = new Map<string, number>();
  list.forEach((item) => byComponent.set(item.component, (byComponent.get(item.component) ?? 0) + 1));
  console.log(
    "按组件汇总：",
    Object.fromEntries([...byComponent.entries()].sort((a, b) => b[1] - a[1])),
  );
  console.groupEnd();
  return list;
}

/** 挂到 window，供控制台按需调用（不自动扫描，避免干扰启动时序） */
export function installSubpixelAudit(): void {
  (window as unknown as Record<string, unknown>).__subpixelAudit = (opts?: SubpixelAuditOptions) =>
    reportSubpixel(opts ?? {});
  console.log(
    "%c[subpixel] dev 自检已就绪：控制台执行 __subpixelAudit() 扫描小数几何",
    "color:#8b8d95",
  );
}
