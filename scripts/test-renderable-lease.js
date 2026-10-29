const assert = require("node:assert");
const { RenderableLease } = require("../electron/dist/renderable-lease.js");

async function main() {
  const events = [];
  const lease = new RenderableLease({
    ttlMs: 120,
    onChange: (windowId, active) => events.push(`${windowId}:${active}`),
  });

  // 引用计数：两次 acquire 只发一次 true，第一次 release 不撤销
  lease.acquire("a");
  lease.acquire("a");
  assert.strictEqual(lease.count("a"), 2, "count should be 2");
  assert.deepStrictEqual(events, ["a:true"], "acquire should emit one true");
  lease.release("a");
  assert.strictEqual(lease.count("a"), 1, "count should drop to 1");
  assert.deepStrictEqual(events, ["a:true"], "partial release must not emit false");
  lease.release("a");
  assert.strictEqual(lease.isActive("a"), false, "lease should be inactive");
  assert.deepStrictEqual(events, ["a:true", "a:false"], "final release emits false");
  console.log("LEASE_OK refcount");

  // TTL 兜底：调用方挂死（永不 release）时自动撤销
  lease.acquire("b");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.strictEqual(lease.isActive("b"), false, "ttl should expire lease");
  assert.deepStrictEqual(events.slice(-2), ["b:true", "b:false"], "ttl emits false");
  console.log("LEASE_OK ttl");

  // releaseAll：单窗口与全部
  lease.acquire("c");
  lease.acquire("d");
  lease.releaseAll("c");
  assert.strictEqual(lease.isActive("c"), false, "releaseAll(window) clears one");
  assert.strictEqual(lease.isActive("d"), true, "releaseAll(window) keeps others");
  lease.dispose();
  assert.strictEqual(lease.isActive("d"), false, "dispose clears all");
  console.log("LEASE_OK releaseAll");

  console.log("RENDERABLE_LEASE_TEST_OK");
}

main().catch((error) => {
  console.error("RENDERABLE_LEASE_TEST_FAILED", error);
  process.exit(1);
});
