#!/usr/bin/env bash
# 实时围观：一条命令把「后端 + 前端界面 + 一次评测」串起来，并且**自动打开正在跑的那个会话**。
#
#   ./eval/watch.sh smoke        # 围观冒烟任务（约 1-2 分钟）
#   ./eval/watch.sh tb 1         # 围观 1 道真题（可能几十分钟）
#
# 做的事：
#   1) 后端不在跑就帮你起（:3000）
#   2) 前端不在跑就帮你起（vite，默认 :5173；被占用会自动换端口）
#   3) 开跑，**轮询到新会话后自动在浏览器打开它的直达链接** `/chat/<sessionId>`
#   4) 用 GUADA_KEEP=1 跑 —— 跑完会话仍在，可回看
#
# 界面上能看到的：推理链、每次工具调用（命令/参数）、执行结果、Token 消耗、绑定的容器工作区。
# 想提前中止：界面上点停止 —— adapter 会轮询 isRunning 立刻感知，**按当前进度结算分数**，
#             不必等超时；也可以 Ctrl+C 停掉 harbor 这一侧。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$PATH:$HOME/.local/bin"
export MSYS_NO_PATHCONV=1

TIER="${1:-smoke}"
ARG="${2:-}"
# 本地配置（个人 provider / model 等，不入库）；调用方环境变量优先
declare -A __ENV_SNAP=()
for __v in GUADA_BASE_URL GUADA_FRONTEND_URL GUADA_JOBS_DIR; do
  [ -n "${!__v:-}" ] && __ENV_SNAP[$__v]="${!__v}"
done
[ -f "$REPO_ROOT/eval/.env.local" ] && . "$REPO_ROOT/eval/.env.local"
for __v in "${!__ENV_SNAP[@]}"; do printf -v "$__v" '%s' "${__ENV_SNAP[$__v]}"; done
unset __ENV_SNAP __v
BASE_URL="${GUADA_BASE_URL:-http://127.0.0.1:3000/api/v1}"
BACKEND_LOG="${GUADA_BACKEND_LOG:-D:/AI/guada-eval/backend.log}"
FRONTEND_LOG="${GUADA_FRONTEND_LOG:-D:/AI/guada-eval/frontend.log}"
RUN_LOG="${GUADA_WATCH_LOG:-D:/AI/guada-eval/watch-run.log}"

probe() { curl -s -w '\n%{http_code}' "$1" 2>/dev/null | tail -1; }

# ── 1) 后端 ────────────────────────────────────────────────
if [ "$(probe "$BASE_URL/auth/status")" != "200" ]; then
  echo "▶ 后端未运行，正在启动（日志：$BACKEND_LOG）…"
  (cd backend-ts && nohup pnpm run start:dev > "$BACKEND_LOG" 2>&1 &)
  for _ in $(seq 1 40); do sleep 5; [ "$(probe "$BASE_URL/auth/status")" = "200" ] && break; done
fi
[ "$(probe "$BASE_URL/auth/status")" = "200" ] || { echo "❌ 后端不可达，看 $BACKEND_LOG"; exit 2; }
echo "✔ 后端就绪"

# ── 2) 前端 ────────────────────────────────────────────────
FRONT_PORT=""
for p in 5173 5174 5175; do
  [ "$(probe "http://localhost:$p/")" = "200" ] && { FRONT_PORT="$p"; break; }
done
if [ -z "$FRONT_PORT" ]; then
  echo "▶ 前端未运行，正在启动（日志：$FRONTEND_LOG）…"
  (cd frontend && nohup pnpm run dev > "$FRONTEND_LOG" 2>&1 &)
  for _ in $(seq 1 24); do
    sleep 5
    for p in 5173 5174 5175; do
      [ "$(probe "http://localhost:$p/")" = "200" ] && { FRONT_PORT="$p"; break 2; }
    done
  done
fi
[ -n "$FRONT_PORT" ] || { echo "❌ 前端起不来，看 $FRONTEND_LOG"; exit 2; }
FRONT_URL="http://localhost:$FRONT_PORT"
echo "✔ 界面就绪：$FRONT_URL"

# ── 3) 记录基线：当前最新的 harbor 会话 ────────────────────
TOKEN=$(curl -s -X POST "$BASE_URL/auth/auto-login" -H "Content-Type: application/json" -d '{}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).access_token||'')}catch(e){console.log('')}})" 2>/dev/null)

newest_harbor_session() {
  curl -s "$BASE_URL/sessions" -H "Authorization: Bearer $TOKEN" 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      try{const j=JSON.parse(d);const a=j.items||[];
        const h=a.filter(s=>String(s.title||'').startsWith('harbor'));
        console.log(h.length?h[0].id:'');
      }catch(e){console.log('')}
    })" 2>/dev/null
}
BASELINE="$(newest_harbor_session)"
echo "   （基线会话：${BASELINE:-无}）"

# ── 4) 开跑（后台），并自动打开新会话 ──────────────────────
echo
echo "════════ 开始跑：$TIER ${ARG} ════════"
# 跑一份脚本快照：bash 是边读边执行的，如果跑的时候正好在编辑 retest.sh，
# 会读到错位的行（表现为莫名其妙的 "unbound variable" / 语法错误）。
SNAP="${TMPDIR:-/tmp}/guada-retest-snapshot.sh"
cp eval/retest.sh "$SNAP"
# 快照在 /tmp 里，必须显式告诉它仓库在哪（否则它按自身路径推会推成 /）
GUADA_REPO_ROOT="$REPO_ROOT" GUADA_KEEP=1 GUADA_FRONTEND_URL="$FRONT_URL" \
  bash "$SNAP" "$TIER" "$ARG" > "$RUN_LOG" 2>&1 &
RUN_PID=$!

SESSION_ID=""
for _ in $(seq 1 40); do
  sleep 3
  CUR="$(newest_harbor_session)"
  if [ -n "$CUR" ] && [ "$CUR" != "$BASELINE" ]; then SESSION_ID="$CUR"; break; fi
  kill -0 "$RUN_PID" 2>/dev/null || break
done

if [ -n "$SESSION_ID" ]; then
  DEEP="$FRONT_URL/chat/$SESSION_ID"
  echo "▶ 正在跑的会话：$DEEP"
  cmd.exe /c start "" "$DEEP" >/dev/null 2>&1 || echo "   （自动打开失败，请手动访问上面的链接）"
else
  echo "⚠ 没轮询到新会话（可能起得慢），可手动打开 $FRONT_URL 看「任务列表」最上方那条"
fi

echo "▶ 想中途停止：界面上点停止（按当前进度结算），或 Ctrl+C"
echo
wait "$RUN_PID"
echo
echo "════════ 本次运行输出（末尾）════════"
tail -18 "$RUN_LOG"
[ -n "$SESSION_ID" ] && echo && echo "回看：$FRONT_URL/chat/$SESSION_ID"
