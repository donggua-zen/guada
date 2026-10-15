# 重测回路（Retest Loop）

改完 harness 后，用**多快的反馈**知道"好了还是坏了"？这里给三档，按需选：

| 档 | 命令 | 耗时 | 成本 | 能发现什么 |
|---|---|---|---|---|
| **T0 · 管线自检** | `./eval/retest.sh oracle` | **≈25 秒/题** | 0 | 任务/验证器/容器链路是否健康（不需要后端、不需要模型） |
| **T1 · 冒烟跑分** | `./eval/retest.sh smoke` | **≈1–2 分钟/题** | 几分钱 | **模型+harness 能否完成一个明确的小任务**（带官方式判分） |
| **T2 · 真题跑分** | `./eval/retest.sh tb 1` | 10–60 分钟/题 | 视题而定 | 真实 benchmark 分数 |

关键：**T0/T1 的镜像用的是已缓存的 `debian:bookworm`，不装任何包**——构建秒级、零网络依赖。
真题（T2）的镜像每个任务都不同（1.7GB 级），首次运行主要成本是拉镜像。

---

## 怎么看解题过程（三选一）

### ① GuaDa 自己的界面（最直观，还能实时看）

**评测会话就是普通的 GuaDa 会话**——它们写在你平时用的那份数据目录（`USERDATA_DIR`）里，
标题形如 `harbor guada 21:26:21`。所以：

- **跑完回看**：`GUADA_KEEP=1 ./eval/retest.sh smoke`（或 `--ak keep_session=true`），
  然后打开 GuaDa 应用 → 会话列表点进去，推理链、工具调用、结果、图片都有现成渲染
- **实时围观**：跑的同时打开那个会话，边跑边看（工具调用会逐条出现）

> ⚠️ 默认 `keep_session=false`——跑完会删掉会话（评测要避免污染会话列表）。
> 想看就得显式打开，见上面的 `GUADA_KEEP=1`。

### ② `harbor view`（benchmark 视角：多任务/多 agent 对比）

```bash
harbor view D:/AI/guada-eval/jobs -p 8080   # 起本地 Web 服务浏览轨迹与分数
```

适合看"同一个模型在不同 harness 下的分数/耗时对比"，是跨任务、跨 agent 的汇总视角。

### ③ 轨迹查看器（可分享、可归档）—— 本仓自带

Harbor 每次 trial 都会把完整轨迹导出到
`jobs/<job>/<trial>/agent/guada-transcript.jsonl`。把它拖进查看器即可：

```bash
# 方式一：直接双击打开（浏览器里拖入 jsonl 文件）
start eval/viewer/trajectory.html

# 方式二：起个静态服务，用 ?src= 直接加载
cd D:/AI/guada-eval && python -m http.server 8090 --bind 127.0.0.1
# 然后打开：
# http://127.0.0.1:8090/trajectory.html?src=jobs/guada-real/xxx/agent/guada-transcript.jsonl
```

查看器提供：左侧**工具调用统计**（点一下即筛选）、**折叠卡片带命令摘要**（不用展开就能扫出干了什么）、
失败高亮（退出码非 0 / Traceback）、长输出折叠、**全文搜索**、一键复制。
不需要启动 GuaDa 应用，适合把一次失败轨迹发给别人看。

---

## 实时围观（跑的同时看它解题）

```bash
./eval/watch.sh smoke        # 围观冒烟任务
./eval/watch.sh tb 1         # 围观真题（长任务时用这个）
```

一条命令做完四件事：起后端（如未跑）→ 起前端界面（如未跑）→ 开跑 →
**自动在浏览器打开这次运行对应的会话**（`http://localhost:<port>/chat/<sessionId>`）。

看什么：推理链、每次工具调用（命令/参数）、执行结果、Token 消耗、绑定的容器工作区。
会话列表在左侧「任务列表」分组，标题形如 `harbor guada HH:MM:SS`。

**中途发现问题就停**：界面上点停止（发送键在流式期间会变成停止键，class 是 `stop-btn`）
→ adapter 轮询 `isRunning` 与轨迹的 `finishReason` 立刻感知 → **按当前进度结算分数**，
不必等超时。实测：22:46:43 点击停止 → 22:47:24 出分，全程 41 秒。

> 跑完会话仍会保留（`GUADA_KEEP=1`），可以回去复盘；末尾也会打印回看链接。

**注意**：界面是你日常用的那一个，跑评测时它会出现新会话；
如果你在同一个标签页里切去看别的会话，就等于停止围观了（建议新开一个窗口专门看）。

---

## 前置

```bash
# 1) 后端必须在跑（T1/T2 需要；T0 不需要）
cd backend-ts && pnpm run start:dev

# 2) 本脚本会自动处理 PATH / PYTHONPATH / MSYS_NO_PATHCONV
```

模型与供应商等个人配置放在 **`eval/.env.local`**（已加入 .gitignore，不会入库）：

```bash
cp eval/.env.local.example eval/.env.local
# 然后填 GUADA_MODEL=<providerId>:<modelName>
# providerId 见 ~/.guada-dev/providers/*.yaml 里的 id 字段
```

两个脚本都会自动加载它；也可以用环境变量临时覆盖：

```bash
GUADA_MODEL=<providerId>:<modelName> ./eval/retest.sh smoke
GUADA_AGENT_ID=code-analyst          # 智能体 id（= ~/.guada-dev/agents 下的目录名）
```

---

## T0 · 管线自检（先跑这个，确认不是任务本身坏了）

```bash
./eval/retest.sh oracle          # 两个冒烟任务用 oracle（参考解）跑，应都得 1.000
```

若 oracle 拿不到 1.000，说明**任务或验证器写坏了**，先修这里——不要在坏任务上烧模型额度。

## T1 · 冒烟跑分（日常迭代主要用这个）

```bash
./eval/retest.sh smoke           # 两个冒烟任务用 GuaDa + 真实模型跑
./eval/retest.sh smoke 01        # 只跑第一个（更快）
```

- `smoke-01-write`：产出指定交付物到指定路径（考"交付物意识"）
- `smoke-02-fix`：读代码 → 定位缺陷 → 修好 → 跑通验收（考"自检闭环"）

**这两个任务本身就是回归用例**：它们分别对应用户最关心的两件事。
改完 harness 后只要这两个从 1.000 掉下来，就是明确的负优化信号。

## T2 · 真题跑分

```bash
./eval/retest.sh tb 1                        # 1 道真题
GUADA_TIMEOUT=600 ./eval/retest.sh tb 3      # 3 道，每题最多 10 分钟（迭代时用短超时）
```

真题任务是**长尾**的：有的 30 秒能做完，有的要几十分钟。迭代阶段建议
`GUADA_TIMEOUT=600`（10 分钟封顶），只在正式跑分时放开。

---

## 加自己的冒烟任务

照着 `eval/tasks/smoke-01-write/` 抄结构即可（Harbor 本地任务格式）：

```
eval/tasks/<你的任务>/
├── instruction.md          # 给 agent 的指令
├── task.toml               # 元数据 + 超时 + artifacts（要拷进验证器的路径）
├── environment/Dockerfile  # 任务环境（建议 FROM debian:bookworm，免拉取免安装）
├── tests/Dockerfile        # 验证器镜像
├── tests/test.sh           # 入口：写 1/0 到 /logs/verifier/reward.txt
└── solution/solve.sh       # oracle 参考解（用来自检任务本身）
```

**写新任务的三条纪律**：

1. **先跑 `-a oracle`**：参考解都拿不到 1.000 的任务是坏任务
2. **验证器要能防作弊**：不要只验一个固定值（smoke-02 用三个不同名字验，就是为了防"写死输出"）
3. **给足诊断输出**：`test.sh` 里多打 `ls -la` / `cat -A`，失败时一眼能看出是"没产出"还是"产出错了"

---

## 单条命令（不走脚本）

```bash
export PATH="$PATH:$HOME/.local/bin"          # harbor 装在这里
export PYTHONPATH='D:/AI/ai_chat'             # adapter 在这里（Harbor 进程不在 cwd 里找模块）
export MSYS_NO_PATHCONV=1                      # Git Bash 会把 /app 这类参数改写成 Windows 路径

cd /d/AI/ai_chat && harbor run -p eval/tasks/smoke-01-write \
  -a eval.harbor.guada_agent:GuaDaAgent \
  -m "$GUADA_MODEL" \
  --ak base_url=http://127.0.0.1:3000/api/v1 \
  --ak turn_timeout_sec=300 \
  -o /d/AI/guada-eval/jobs --job-name my-retest -y
```
