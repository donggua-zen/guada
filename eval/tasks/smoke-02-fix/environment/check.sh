#!/bin/sh
# 验收脚本：greet.sh 必须对任意名字输出 "Hello, <name>!"
out=$(sh /app/greet.sh World)
if [ "$out" = "Hello, World!" ]; then
  echo "OK"
  exit 0
fi
echo "FAIL: 期望 'Hello, World!'，实际 '$out'"
exit 1
