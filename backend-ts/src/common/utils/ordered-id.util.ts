/**
 * 有序消息 id（ULID 基座）
 *
 * messageId = `m_<ULID>`（普通消息） / `c_<ULID>`（压缩检查点）。
 * - ULID：48 位毫秒时间戳 + 80 位随机，Crockford base32 编码，26 字符，按字典序 = 按时间序；
 *   同毫秒单调递增（严格有序），时钟回拨时钳制到上次时间戳。
 * - 前缀：ASCII 'c' < 'm' → 检查点恒排序在所有消息之前。
 *   surface 经压缩后 = [检查点 c_*, 保留消息 m_*...]，仍按 id 单调 →
 *   遮蔽区间 [startId, endId] 对前端/replayer 的字符串比较保持有效。
 * - 同步生成、无持久化状态（有序性由 ULID 自身时间基座保证，跨重启不回退——时钟单调前提下）。
 */
import { randomBytes } from 'crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 同毫秒单调状态（模块级单例，跨会话/存储共享 → 所有生成路径严格有序） */
let lastTimestamp = 0;
let lastRandom = 0n;

/** 生成单调 ULID（26 字符：时间 10 + 随机 16） */
function generateUlid(): string {
  let ts = Date.now();
  if (ts < lastTimestamp) ts = lastTimestamp; // 时钟回拨：钳制到上次时间戳
  let rand = BigInt('0x' + randomBytes(10).toString('hex'));
  if (ts === lastTimestamp) {
    // 同毫秒：低位递增 → 整个 26 字符串严格递增（时间相同则随机低位决定序）
    rand = lastRandom + 1n;
  }
  lastTimestamp = ts;
  lastRandom = rand;
  return encodeUlid(BigInt(ts), rand);
}

function encodeUlid(ts: bigint, rand: bigint): string {
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[Number(ts & 31n)] + out;
    ts >>= 5n;
  }
  for (let i = 0; i < 16; i++) {
    out += CROCKFORD[Number(rand & 31n)];
    rand >>= 5n;
  }
  return out;
}

/**
 * 生成下一个有序消息 id。
 * @param kind 'm'=普通消息（默认） / 'c'=压缩检查点（恒排序在所有消息之前）
 */
export function generateOrderedMessageId(kind: 'm' | 'c' = 'm'): string {
  return `${kind}_${generateUlid()}`;
}

/** 解析有序 id → { prefix, ulid }；非本格式（旧 m_<ts>_<rand> / msg_* / __compact_*）返回 null */
export function parseOrderedId(
  id: string,
): { prefix: 'm' | 'c'; ulid: string } | null {
  const m = /^([mc])_([0-9A-Z]{26})$/.exec(id);
  return m ? { prefix: m[1] as 'm' | 'c', ulid: m[2] } : null;
}
