#!/bin/bash
# 冒烟任务 01 的验证器：纯 bash，无依赖（不装 pytest / uv → 验证秒级完成）
# 契约：/logs/verifier/reward.txt 写 1（通过）或 0（失败）

RESULT=/app/output/result.txt
mkdir -p /logs/verifier
fail() { echo "[FAIL] $*"; echo 0 > /logs/verifier/reward.txt; exit 1; }

echo "=== 冒烟任务 01 验证 ==="
echo "--- /app 树 ---"
ls -la /app 2>&1 || true
echo "--- /app/output ---"
ls -la /app/output 2>&1 || true

[ -e "$RESULT" ] || fail "$RESULT 不存在（agent 没有产出交付物）"
[ -f "$RESULT" ] || fail "$RESULT 存在但不是普通文件"

echo "--- 内容（cat -A，便于看出行尾/空行）---"
cat -A "$RESULT" || true
echo "--- 行数 ---"
LINES=$(wc -l < "$RESULT" | tr -d ' ')
echo "行数=$LINES"

L1=$(sed -n '1p' "$RESULT")
L2=$(sed -n '2p' "$RESULT")

[ "$L1" = "SMOKE_OK" ] || fail "第 1 行应为 SMOKE_OK，实际为 '$L1'"
[ -n "$L2" ] || fail "第 2 行不能为空（应为 uname -m 的输出）"
echo "$L2" | grep -qE '^[A-Za-z0-9_]{3,16}$' || fail "第 2 行不像架构标识：'$L2'"
[ "$LINES" -eq 2 ] || fail "应为 2 行，实际 $LINES 行（注意结尾换行）"

echo "[PASS] 交付物存在且内容符合要求"
echo 1 > /logs/verifier/reward.txt
exit 0
