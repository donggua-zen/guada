@echo off
REM BM25 对比测试自动化脚本 (Windows)
REM 
REM 用法: run_bm25_comparison.bat

echo ==========================================
echo BM25 评分对比测试
echo ==========================================

set BACKEND_TS_DIR=%~dp0
set BACKEND_DIR=%BACKEND_TS_DIR%..\backend

echo.
echo 步骤 1: 运行 Python 端测试...
echo ------------------------------------------
cd /d "%BACKEND_DIR%"
python tests/verification/test_bm25_diff.py

if not exist "tests\verification\bm25_python_results.json" (
    echo ❌ Python 端测试失败，未生成结果文件
    exit /b 1
)

echo.
echo ✅ Python 端测试完成

echo.
echo 步骤 2: 运行 TypeScript 端测试并对比...
echo ------------------------------------------
cd /d "%BACKEND_TS_DIR%"
npx ts-node scripts/compare-bm25.ts

if not exist "bm25_ts_results.json" (
    echo ❌ TypeScript 端测试失败，未生成结果文件
    exit /b 1
)

echo.
echo ✅ TypeScript 端测试完成

echo.
echo 步骤 3: 生成可视化报告...
echo ------------------------------------------

REM 检查是否生成了对比报告
if exist "bm25_comparison_report.json" (
    echo ✅ 对比报告已生成: bm25_comparison_report.json
    
    REM 显示关键统计信息
    echo.
    echo 关键指标摘要:
    node -e "const report = require('./bm25_comparison_report.json'); const avgAbsError = report.reduce((sum, r) => sum + r.avg_absolute_error, 0) / report.length; const avgRelError = report.reduce((sum, r) => sum + r.avg_relative_error, 0) / report.length; const consistentCount = report.filter(r => r.ranking_consistent).length; console.log('  平均绝对误差:', avgAbsError.toFixed(6)); console.log('  平均相对误差:', (avgRelError * 100).toFixed(2) + '%%'); console.log('  排名一致性:', consistentCount + '/' + report.length);"
) else (
    echo ⚠️  未生成对比报告（可能缺少 Python 端结果）
)

echo.
echo ==========================================
echo 测试完成！
echo ==========================================
echo.
echo 生成的文件:
echo   - backend/tests/verification/bm25_python_results.json
echo   - backend-ts/bm25_ts_results.json
echo   - backend-ts/bm25_comparison_report.json
echo.
echo 详细分析报告:
echo   - docs/HYBRID_SEARCH_BM25_ANALYSIS.md
echo   - docs/BM25_FIX_SUMMARY.md
echo.

pause
