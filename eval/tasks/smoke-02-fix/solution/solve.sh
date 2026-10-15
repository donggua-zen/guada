#!/bin/bash
# oracle 参考解：修好 greet.sh（补上逗号）
set -euo pipefail
cat > /app/greet.sh <<'EOF'
#!/bin/sh
# 打印问候语。预期：Hello, <name>!
echo "Hello, $1!"
EOF
sh /app/check.sh
