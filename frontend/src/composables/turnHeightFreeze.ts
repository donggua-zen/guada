/**
 * 回合高度的「冻结」：拖拽/缩放期间临时把每个已挂载回合的真实高度写进内联
 * `contain-intrinsic-size`，让 `content-visibility` 生效时**布局高度完全不变**。
 *
 * 为什么必须冻结：`content-visibility: auto` 隐含 `contain: layout`，除了让离屏元素
 * 跳过渲染，还会阻止子元素 margin 折叠出父元素——于是同一个回合在 cv 开/关两种状态下
 * 高度不一致。实测 40 回合（每回合约 500px）：只挂 cv 时 scrollHeight 20728 → 30562
 * （涨 9834px），浏览器把 scrollTop 从 19843 钳到 120，可见内容直接跳到第一条。
 * 写入实测高度后：heightDelta = 0、可见回合不变、滚动位置不变。
 *
 * 与 `contain-intrinsic-size: auto <len>` 的区别：`auto` 只对「cv 生效期间渲染过」的
 * 元素记忆尺寸，对首次进入 cv 状态的元素无效，所以救不了这个场景。
 *
 * 代价：一次全量读高度（一遍 getBoundingClientRect）+ 一次全量写内联样式。
 * 实测 300 回合约 1.6ms、600 回合约 2.6ms，只在手势**第一次产生位移**时执行一次。
 *
 * 只在调整期写入；退出时全部移除，真实布局恢复。
 */

/** 回合根元素选择器（TurnItem 根节点，与 TurnItem.vue 的 CSS 规则对应）。 */
const TURN_SELECTOR = '.turn-wrapper'

/**
 * 读一遍当前所有回合的真实高度，写入内联 `contain-intrinsic-size`。
 *
 * 先全部读、再全部写：读写交替会让每个元素各触发一次强制布局，
 * 300 个回合会从 1.6ms 涨到几十毫秒。
 */
export function freezeTurnHeights(): void {
  if (typeof document === 'undefined') return
  const turns = document.querySelectorAll<HTMLElement>(TURN_SELECTOR)
  if (turns.length === 0) return

  const heights = new Array<number>(turns.length)
  for (let i = 0; i < turns.length; i += 1) {
    heights[i] = turns[i].getBoundingClientRect().height
  }
  for (let i = 0; i < turns.length; i += 1) {
    turns[i].style.containIntrinsicSize = `${heights[i]}px`
  }
}

/** 移除冻结，让回合回到按真实内容计算高度。 */
export function releaseTurnHeights(): void {
  if (typeof document === 'undefined') return
  const turns = document.querySelectorAll<HTMLElement>(TURN_SELECTOR)
  for (let i = 0; i < turns.length; i += 1) {
    turns[i].style.removeProperty('contain-intrinsic-size')
  }
}
