const assert = require("node:assert/strict");
const {
  MAX_TABS_PER_SESSION,
  TAB_WARN_THRESHOLD,
  buildTabSummary,
  listCreatorTabs,
  tabLimitMessage,
} = require("../electron/dist/browser-tab-policy.js");

function win(id, createdBy, extra = {}) {
  return {
    windowId: id,
    title: `Tab ${id}`,
    url: `https://${id}.test/`,
    createdAt: 1,
    lastActiveAt: 1,
    isActive: false,
    isMainApp: false,
    isVisible: false,
    ...(createdBy ? { metadata: { createdBy } } : {}),
    ...extra,
  };
}

function tabs(count, createdBy = "s1") {
  return Array.from({ length: count }, (_, i) => win(`t${i}`, createdBy));
}

assert.equal(MAX_TABS_PER_SESSION, 8);
assert.equal(TAB_WARN_THRESHOLD, 6);

// createdBy 过滤、稳定 index、current 标记
const mixed = [
  win("a", "s1"),
  win("user-only"),
  win("b", "other"),
  win("c", "s1"),
];
const listed = listCreatorTabs(mixed, "s1", "c");
assert.deepEqual(
  listed.map((tab) => tab.tabId),
  ["a", "c"],
);
assert.equal(listed[1].index, 1);
assert.equal(listed[1].isCurrent, true);
assert.deepEqual(listCreatorTabs(mixed, ""), []);
console.log("TAB_POLICY_OK filters and indexes");

// 5 个：不提醒、不带完整列表
const five = buildTabSummary(tabs(5), "s1", "t4");
assert.equal(five.count, 5);
assert.equal(five.limit, 8);
assert.equal(five.current.tabId, "t4");
assert.equal(five.items, undefined);
assert.equal(five.warning, undefined);
console.log("TAB_POLICY_OK below warning threshold");

// 6 个：软提醒 + 完整列表
const six = buildTabSummary(tabs(6), "s1", "t5");
assert.equal(six.items.length, 6);
assert.match(six.warning, /6\/8/);
assert.match(six.warning, /browser\.tabs\.close/);
console.log("TAB_POLICY_OK warning threshold");

// includeItems 强制列表
const two = buildTabSummary(tabs(2), "s1", "t0", { includeItems: true });
assert.equal(two.items.length, 2);
assert.equal(two.warning, undefined);
console.log("TAB_POLICY_OK includeItems");

// 满额：明确会返回 TAB_LIMIT
const eight = buildTabSummary(tabs(8), "s1", "t7");
assert.equal(eight.count, 8);
assert.equal(eight.items.length, 8);
assert.match(eight.warning, /Tab limit reached/);
assert.match(eight.warning, /TAB_LIMIT/);
assert.match(tabLimitMessage(8), /8\/8/);
assert.match(tabLimitMessage(8), /browser\.tabs\.close/);
console.log("TAB_POLICY_OK hard limit");

// 没有 createdBy 时保持旧返回形状
assert.equal(buildTabSummary(tabs(2), "", "t0"), undefined);
console.log("TAB_POLICY_OK anonymous session");

console.log("TAB_POLICY_TEST_OK");
