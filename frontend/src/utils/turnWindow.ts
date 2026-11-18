/**
 * 回合窗口（有界挂载）的纯决策层。
 *
 * 背景：懒挂载只延迟「首次创建」，回合一旦挂载就永久保留。长会话浏览历史后，
 * 已挂载回合会持续累积，窗口最大化/还原等一次全量布局的代价随之线性增长
 * （实测 30 回合约 173ms Layout，9 回合约 46ms）。
 *
 * 这里只做几何判定：给定每个已挂载回合相对滚动视口的位置，算出哪些可以卸载为占位。
 * DOM 读取、高度缓存与滚动锚点补偿由调用方（ChatPanel）负责。
 *
 * 关键约束：
 * - **保护区**：尾部回合（流式输出所在处）与调用方指定的 id 永不卸载；
 * - **滞回**：卸载边界（keepMarginPx）必须明显大于挂载边界（IntersectionObserver 的
 *   800px），否则挂载/卸载会在同一条边界上反复抖动；
 * - **上限兜底**：即使全部落在滞回区内，也按「离视口最远」优先卸载，保证已挂载数量有界。
 */

/** 已挂载回合的几何快照（top/bottom 相对滚动视口顶部，height 含上下外边距）。 */
export interface MountedTurnGeometry {
  id: string
  top: number
  bottom: number
  height: number
}

export interface TurnWindowPlanOptions {
  /** 滚动视口高度（clientHeight） */
  viewportHeight: number
  /** 卸载滞回边界：回合完全离开 [视口上下各 keepMarginPx] 才考虑卸载 */
  keepMarginPx: number
  /** 已挂载回合数上限（保护区与视口内的回合始终保留，可能超过该值） */
  maxMounted: number
  /** 永不卸载的回合（尾部回合、正在流式的回合等） */
  protectedIds?: ReadonlySet<string>
}

export interface TurnWindowPlan {
  /** 应卸载为占位的回合（按离视口由远到近） */
  unmount: MountedTurnGeometry[]
  /** 卸载后仍保持挂载的数量 */
  remaining: number
}

/** 回合与视口的距离：相交为 0，否则为到最近边的像素距离。 */
export function distanceToViewport(
  entry: MountedTurnGeometry,
  viewportHeight: number,
): number {
  if (entry.bottom < 0) return -entry.bottom
  if (entry.top > viewportHeight) return entry.top - viewportHeight
  return 0
}

/**
 * 规划本轮可卸载的回合。
 *
 * 两轮筛选：
 * 1. 保护区与滞回区内的回合保留，其余全部卸载；
 * 2. 若保留数仍超过 maxMounted，按离视口由远到近继续卸载（跳过保护区与视口内回合）。
 */
export function planTurnWindow(
  entries: ReadonlyArray<MountedTurnGeometry>,
  options: TurnWindowPlanOptions,
): TurnWindowPlan {
  const { viewportHeight, keepMarginPx, maxMounted, protectedIds } = options;
  const isProtected = (id: string): boolean => protectedIds?.has(id) === true;

  const unmount: MountedTurnGeometry[] = [];
  const kept: MountedTurnGeometry[] = [];

  for (const entry of entries) {
    if (isProtected(entry.id)) {
      kept.push(entry);
      continue;
    }
    const outside =
      entry.bottom < -keepMarginPx || entry.top > viewportHeight + keepMarginPx;
    if (outside) unmount.push(entry);
    else kept.push(entry);
  }

  let remaining = kept.length;
  if (remaining > maxMounted) {
    // 超出上限：从离视口最远的非保护区、非视口内回合开始卸载
    const candidates = kept
      .filter((entry) => !isProtected(entry.id) && distanceToViewport(entry, viewportHeight) > 0)
      .sort(
        (a, b) =>
          distanceToViewport(b, viewportHeight) - distanceToViewport(a, viewportHeight),
      );
    const extra = remaining - maxMounted;
    for (let i = 0; i < extra && i < candidates.length; i += 1) {
      unmount.push(candidates[i]);
      remaining -= 1;
    }
  }

  unmount.sort(
    (a, b) => distanceToViewport(b, viewportHeight) - distanceToViewport(a, viewportHeight),
  );

  return { unmount, remaining };
}

/**
 * 占位高度：优先用上次实测值（含上下外边距），没有实测值时回落到估算。
 *
 * 为什么不按宽度缩放实测值：宽度变化后旧高度确实会失真，但该回合此刻在视口外，
 * 用户看不到；它重新进入视口时会立即挂载并按真实高度替换，滚动锚点保持器负责
 * 抵消这次高度差。按宽度线性缩放反而会把「内容换行导致的高度非线性变化」放大。
 */
export function resolvePlaceholderHeight(
  measured: number | undefined,
  estimatePx: number,
): number {
  if (typeof measured === 'number' && Number.isFinite(measured) && measured > 0) {
    return Math.round(measured);
  }
  return estimatePx;
}
