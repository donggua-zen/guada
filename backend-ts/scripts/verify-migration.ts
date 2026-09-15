/**
 * 迁移产物验证脚本：用真实 replayer 折叠迁移后的 JSONL，
 * 确认视图重建、turn/finish 锚点、compaction 历史三条链路完好。
 *
 * 用法：SESSION_DATA_DIR=<root> npx ts-node --transpile-only scripts/verify-migration.ts <sessionId>...
 */
import "dotenv/config";
import { JsonlBackend } from "../src/common/persistence/jsonl-backend";
import { foldEvents } from "../src/common/persistence/replayer";
import { SessionReplayService } from "../src/modules/chat/session-replay.service";

async function main() {
  const ids = process.argv.slice(2);
  const backend = new JsonlBackend();
  const replay = new SessionReplayService(backend as any);

  for (const sid of ids) {
    const events = await backend.getAllEvents(sid);
    const state = foldEvents(events);
    const history = await replay.getCompactionHistory(sid);

    // 最后一个占用锚点（turn/finish 或 compaction/end）
    let anchor: { usedTokens?: number; effectiveContextWindow?: number } = {};
    for (const e of events) {
      const d = e.data as any;
      if (e.type === "turn/finish" || e.type === "compaction/end") {
        if (typeof d?.usedTokens === "number" && typeof d?.effectiveContextWindow === "number") {
          anchor = { usedTokens: d.usedTokens, effectiveContextWindow: d.effectiveContextWindow };
        }
      }
    }
    const finishEvents = events.filter((e) => e.type === "turn/finish").length;
    const compactionEvents = events.filter((e) => e.type.startsWith("compaction/")).length;

    console.log(
      [
        `session ${sid}`,
        `events=${events.length}`,
        `turnFinish=${finishEvents}`,
        `compactionEvents=${compactionEvents}`,
        `foldedView=${state.messages.length} msgs`,
        `anchor=${JSON.stringify(anchor)}`,
        `compactionHistory: total=${history.total}`,
        JSON.stringify(
          history.items.slice(0, 2).map((i) => ({
            strategy: i.cleaningStrategy,
            shadowed: i.shadowedCount,
            before: i.compressionStats.beforeTokenCount,
            after: i.compressionStats.afterTokenCount,
            summaryChars: i.summaryContent?.length ?? 0,
          })),
        ),
      ].join(" | "),
    );
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
