#!/bin/bash

# 思考时长功能验证脚本
# 该脚本用于快速验证代码修改是否正确

echo "======================================"
echo "   思考时长功能代码验证"
echo "======================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查计数
CHECKS_PASSED=0
CHECKS_FAILED=0

# 检查函数
check_file_contains() {
    local file=$1
    local pattern=$2
    local description=$3
    
    if grep -q "$pattern" "$file" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $description"
        ((CHECKS_PASSED++))
        return 0
    else
        echo -e "${RED}✗${NC} $description"
        ((CHECKS_FAILED++))
        return 1
    fi
}

echo "1. 后端代码检查..."
echo "------------------------------------"

# 检查后端文件是否存在
if [ -f "backend/app/services/agent_service.py" ]; then
    echo -e "${GREEN}✓${NC} agent_service.py 存在"
    ((CHECKS_PASSED++))
    
    # 检查关键代码
    check_file_contains "backend/app/services/agent_service.py" "_thinking_started_at" "包含思考开始时间记录"
    check_file_contains "backend/app/services/agent_service.py" "_thinking_finished_at" "包含思考结束时间记录"
    check_file_contains "backend/app/services/agent_service.py" "thinking_duration_ms" "包含思考时长计算"
    check_file_contains "backend/app/services/agent_service.py" "meta_data\[\"thinking_duration_ms\"\]" "保存到 meta_data"
else
    echo -e "${RED}✗${NC} backend/app/services/agent_service.py 不存在"
    ((CHECKS_FAILED++))
fi

echo ""
echo "2. 前端 ChatPanel.vue 检查..."
echo "------------------------------------"

if [ -f "frontend/src/components/ChatPanel.vue" ]; then
    echo -e "${GREEN}✓${NC} ChatPanel.vue 存在"
    ((CHECKS_PASSED++))
    
    # 检查关键代码
    check_file_contains "frontend/src/components/ChatPanel.vue" "thinking_started_at" "包含思考开始时间字段"
    check_file_contains "frontend/src/components/ChatPanel.vue" "thinking_duration_ms" "包含思考时长字段"
    check_file_contains "frontend/src/components/ChatPanel.vue" "_thinkingTimer" "包含计时器逻辑"
    check_file_contains "frontend/src/components/ChatPanel.vue" "setInterval" "使用 setInterval 计时"
    check_file_contains "frontend/src/components/ChatPanel.vue" "clearInterval" "清除计时器"
    check_file_contains "frontend/src/components/ChatPanel.vue" "从 meta_data 中回填 thinking_duration_ms" "历史数据回填逻辑"
else
    echo -e "${RED}✗${NC} frontend/src/components/ChatPanel.vue 不存在"
    ((CHECKS_FAILED++))
fi

echo ""
echo "3. 前端 MessageItem.vue 检查..."
echo "------------------------------------"

if [ -f "frontend/src/components/MessageItem.vue" ]; then
    echo -e "${GREEN}✓${NC} MessageItem.vue 存在"
    ((CHECKS_PASSED++))
    
    # 检查关键代码
    check_file_contains "frontend/src/components/MessageItem.vue" "formatDuration" "包含时长格式化函数"
    check_file_contains "frontend/src/components/MessageItem.vue" "已思考" "显示思考中状态"
    check_file_contains "frontend/src/components/MessageItem.vue" "思考耗时" "显示完成状态"
    check_file_contains "frontend/src/components/MessageItem.vue" "turn.meta_data?.thinking_duration_ms" "兼容 meta_data 读取"
else
    echo -e "${RED}✗${NC} frontend/src/components/MessageItem.vue 不存在"
    ((CHECKS_FAILED++))
fi

echo ""
echo "4. Python 语法检查..."
echo "------------------------------------"

cd backend
if python -c "import ast; ast.parse(open('app/services/agent_service.py', encoding='utf-8').read())" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} agent_service.py 语法正确"
    ((CHECKS_PASSED++))
else
    echo -e "${RED}✗${NC} agent_service.py 语法错误"
    ((CHECKS_FAILED++))
fi
cd ..

echo ""
echo "======================================"
echo "   验证结果汇总"
echo "======================================"
echo -e "通过：${GREEN}$CHECKS_PASSED${NC}"
echo -e "失败：${RED}$CHECKS_FAILED${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}所有检查通过！代码修改完成。${NC}"
    echo ""
    echo "下一步操作："
    echo "1. 启动后端服务：cd backend && python -m uvicorn app.main:app --reload"
    echo "2. 启动前端服务：cd frontend && npm run dev"
    echo "3. 访问 http://localhost:5173 测试功能"
    echo "4. 查看测试指南：TEST_THINKING_DURATION.md"
    exit 0
else
    echo -e "${RED}部分检查失败，请检查代码修改。${NC}"
    exit 1
fi
