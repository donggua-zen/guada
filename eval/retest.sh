#!/usr/bin/env bash
# GuaDa 评测重测脚本 —— 三档反馈，见 eval/README.md
#
#   ./eval/retest.sh oracle          # T0 管线自检（≈25s/题，零成本，不需后端）
#   ./eval/retest.sh smoke [01|02]   # T1 冒烟跑分（≈1-2 分钟/题，真实模型）
#   ./eval/retest.sh tb [n]          # T2 真题跑分（10-60 分钟/题）
#
# 环境变量：
#   GUADA_MODEL    模型 id（providerId:modelName）—— 必填，放 eval/.env.local（不入库）
#   GUADA_BASE_URL 后端基址，默认 http://127.0.0.1:3000/api/v1
#   GUADA_AGENT_ID 智能体 id，默认 code-analyst
#   GUADA_TIMEOUT  adapter 单轮墙钟上限（秒），默认 300；跑真题时按需放宽
#   GUADA_JOBS_DIR 结果目录，默认 D:/AI/guada-eval/jobs
set -uo pipefail

# 仓库根：优先用外部传入（watch.sh 跑脚本快照时用得到——快照在 /tmp 里，
# 靠自身路径推算会算成 /），否则按脚本位置推。
REPO_ROOT="${GUADA_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

# 本地配置（个人 provider / model 等，不入库；模板见 .env.local.example）
# 优先级：调用方环境变量 > .env.local > 脚本默认值
declare -A __ENV_SNAP=()
for __v in GUADA_MODEL GUADA_BASE_URL GUADA_AGENT_ID GUADA_FRONTEND_URL GUADA_TIMEOUT GUADA_JOBS_DIR GUADA_KEEP; do
  [ -n "${!__v:-}" ] && __ENV_SNAP[$__v]="${!__v}"
done
[ -f "$REPO_ROOT/eval/.env.local" ] && . "$REPO_ROOT/eval/.env.local"
for __v in "${!__ENV_SNAP[@]}"; do printf -v "$__v" '%s' "${__ENV_SNAP[$__v]}"; done
unset __ENV_SNAP __v

# Windows 侧 python/harbor 需要 Windows 风格路径；同时关掉 MSYS 路径改写（否则 /app 会被改写）
REPO_WIN="$(cygpath -m "$REPO_ROOT" 2>/dev/null || echo "$REPO_ROOT")"
JOBS_WIN="${GUADA_JOBS_DIR:-D:/AI/guada-eval/jobs}"
export PATH="$PATH:$HOME/.local/bin"
export PYTHONPATH="$REPO_WIN"
export MSYS_NO_PATHCONV=1

MODEL="${GUADA_MODEL:-}"
BASE_URL="${GUADA_BASE_URL:-http://127.0.0.1:3000/api/v1}"
AGENT_ID="${GUADA_AGENT_ID:-code-analyst}"
TIMEOUT="${GUADA_TIMEOUT:-300}"
# GUADA_KEEP=1 → 跑完保留会话（便于在 GuaDa 界面里回看解题过程；默认跑完即删）
KEEP_FLAG=""
[ "${GUADA_KEEP:-0}" = "1" ] && KEEP_FLAG="--ak keep_session=true"
# 前端地址：填了就打印该会话的直达链接（配合 eval/watch.sh 自动打开界面）
FRONT_URL="${GUADA_FRONTEND_URL:-}"
FRONT_FLAG=""
[ -n "$FRONT_URL" ] && FRONT_FLAG="--ak frontend_url=$FRONT_URL"

TIER="${1:-smoke}"
ARG="${2:-}"
# Harbor 拒绝复用已存在的 job 目录，所以每次运行都带时间戳
RUN_ID="$(date +%m%d-%H%M%S)"

command -v harbor >/dev/null 2>&1 || { echo "找不到 harbor，请先 uv tool install harbor"; exit 2; }

require_backend() {
  # 注意：不能依赖 `-o /dev/null`——本脚本开了 MSYS_NO_PATHCONV=1，
  # /dev/null 不会被转成 NUL，Windows 版 curl 会报错并让退出码非 0。
  code=$(curl -s -w '\n%{http_code}' "${BASE_URL}/auth/status" 2>/dev/null | tail -1)
  if [ "$code" != "200" ]; then
    echo "❌ 后端不可达（${BASE_URL}/auth/status -> ${code:-无响应}）"
    echo "   先启动：cd backend-ts && pnpm run start:dev"
    exit 2
  fi
}

# 从 job 的 result.json 里取分数
reward_of() {
  node -e "
    const fs=require('fs');
    try{
      const j=JSON.parse(fs.readFileSync('$1/result.json','utf8'));
      const ev=j.stats.evals||{};
      const k=Object.keys(ev)[0];
      const m=k&&ev[k].metrics&&ev[k].metrics[0]&&ev[k].metrics[0].mean;
      const errs=k?ev[k].n_errors:0;
      console.log((m===null||m===undefined?'?':m)+' (errors='+(errs||0)+', trials='+j.stats.n_completed_trials+'/'+j.n_total_trials+')');
    }catch(e){console.log('? (无法读取 result.json)')}
  " 2>/dev/null
}

require_model() {
  if [ -z "$MODEL" ]; then
    echo "❌ 未配置模型（GUADA_MODEL）"
    echo "   方式一：export GUADA_MODEL=<providerId>:<modelName>"
    echo "   方式二：cp eval/.env.local.example eval/.env.local 后填好（推荐，不会入库）"
    echo "   providerId 见 ~/.guada-dev/providers/*.yaml 里的 id 字段"
    exit 2
  fi
}

run_task() {
  local task="$1" agent="$2" jobname="$3" extra="$4" model="$5"
  echo "──── $task  ──  agent=$agent"
  # shellcheck disable=SC2086
  harbor run -p "$task" -a "$agent" ${model:+-m "$model"} $extra \
    -o "$JOBS_WIN" --job-name "$jobname" -y 2>&1 | grep -E "Mean:|runtime:|容器候选|附着容器|连接已建|会话已建|一轮结束|轨迹已导出|Error|error|Traceback" | head -20
  echo "  → 分数: $(reward_of "$JOBS_WIN/$jobname")"
}

case "$TIER" in
  oracle)
    echo "### T0 管线自检（oracle 参考解，应全为 1）"
    run_task "eval/tasks/smoke-01-write" "oracle" "retest-oracle-01-$RUN_ID" ""
    run_task "eval/tasks/smoke-02-fix"   "oracle" "retest-oracle-02-$RUN_ID" ""
    ;;

  smoke)
    require_backend
    require_model
    echo "### T1 冒烟跑分  模型=$MODEL  超时=${TIMEOUT}s"
    EXTRA="--ak base_url=$BASE_URL --ak agent_id=$AGENT_ID --ak turn_timeout_sec=$TIMEOUT $KEEP_FLAG $FRONT_FLAG"
    if [ "$ARG" = "01" ]; then
      run_task "eval/tasks/smoke-01-write" "eval.harbor.guada_agent:GuaDaAgent" "retest-smoke-01-$RUN_ID" "$EXTRA" "$MODEL"
    elif [ "$ARG" = "02" ]; then
      run_task "eval/tasks/smoke-02-fix" "eval.harbor.guada_agent:GuaDaAgent" "retest-smoke-02-$RUN_ID" "$EXTRA" "$MODEL"
    else
      run_task "eval/tasks/smoke-01-write" "eval.harbor.guada_agent:GuaDaAgent" "retest-smoke-01-$RUN_ID" "$EXTRA" "$MODEL"
      run_task "eval/tasks/smoke-02-fix"   "eval.harbor.guada_agent:GuaDaAgent" "retest-smoke-02-$RUN_ID" "$EXTRA" "$MODEL"
    fi
    ;;

  tb)
    require_backend
    require_model
    N="${ARG:-1}"
    echo "### T2 真题跑分  任务数=$N  模型=$MODEL  超时=${TIMEOUT}s"
    harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker \
      -a eval.harbor.guada_agent:GuaDaAgent -m "$MODEL" \
      --ak base_url="$BASE_URL" --ak agent_id="$AGENT_ID" --ak turn_timeout_sec="$TIMEOUT" $KEEP_FLAG $FRONT_FLAG \
      -l "$N" -k 1 -n 1 --agent-timeout-multiplier 2 \
      -o "$JOBS_WIN" --job-name "retest-tb-$N-$RUN_ID" -y 2>&1 | tail -22
    echo "  → 分数: $(reward_of "$JOBS_WIN/retest-tb-$N-$RUN_ID")"
    ;;

  *)
    echo "用法: $0 {oracle|smoke [01|02]|tb [n]}"; exit 2
    ;;
esac
