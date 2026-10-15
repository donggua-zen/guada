#!/bin/bash
# oracle 参考解：应得满分（用于自检"任务本身没写坏"）
set -euo pipefail
mkdir -p /app/output
printf 'SMOKE_OK\n%s\n' "$(uname -m)" > /app/output/result.txt
cat /app/output/result.txt
