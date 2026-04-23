#!/bin/bash

# Electron 构建脚本
# 编译 Electron TypeScript 文件

echo "🔨 编译 Electron 主进程..."

cd "$(dirname "$0")"

# 检查是否安装了 typescript
if ! command -v tsc &> /dev/null; then
    echo "❌ 未找到 tsc 命令，正在安装 TypeScript..."
    npm install -g typescript
fi

# 编译 TypeScript
tsc --project tsconfig.json

if [ $? -eq 0 ]; then
    echo "✅ Electron 编译成功！"
    echo "输出目录: $(pwd)/dist"
else
    echo "❌ Electron 编译失败！"
    exit 1
fi
