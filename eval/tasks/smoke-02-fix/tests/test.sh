#!/bin/bash
# 冒烟任务 02 的验证器：纯 bash，无依赖
# 关键设计：用**多个不同的名字**验证，防止 agent 把输出写死成 "Hello, World!"
# 契约：/logs/verifier/reward.txt 写 1（通过）或 0（失败）

GREET=/app/greet.sh
mkdir -p /logs/verifier
fail() { echo "[FAIL] $*"; echo 0 > /logs/verifier/reward.txt; exit 1; }

echo "=== 冒烟任务 02 验证 ==="
echo "--- /app ---"; ls -la /app 2>&1 || true
echo "--- greet.sh 内容 ---"; cat -A "$GREET" 2>&1 || true

[ -f "$GREET" ] || fail "$GREET 不存在"

check_name() {
  name="$1"
  expected="Hello, $name!"
  actual=$(sh "$GREET" "$name" 2>&1)
  echo "  名字=$name  期望='$expected'  实际='$actual'"
  [ "$actual" = "$expected" ] || fail "名字 $name 的输出不匹配"
}
check_name World
check_name Ada
check_name 'X Æ-9'   # 带空格与非 ASCII，进一步排除写死/拼接错误

echo "[PASS] greet.sh 对多个名字都输出正确"
echo 1 > /logs/verifier/reward.txt
exit 0
