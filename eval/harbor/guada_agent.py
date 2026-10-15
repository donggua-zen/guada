"""
Harbor 自定义 Agent：把 GuaDa 接进 Harbor 的任务容器。

设计（详见 docs/agent-benchmark-integration.md）：
- GuaDa 的 agent loop 留在宿主侧的后端进程里；
- Harbor 造好任务容器后，本 adapter 只做三件事：
  1) 解析容器标识（由 Harbor 的 session_id 推出 compose 容器名）
  2) 调 GuaDa API 建一条"附着该容器"的工作区连接，并建会话绑定它
  3) 把任务指令作为一轮对话发进去，等结束，上报 token
- agent 二进制注入、平台探测、版本门禁全部由 GuaDa 侧自动完成（docker-agent-connect.ts）。

用法：
    harbor run -d terminal-bench/terminal-bench@4.0.0 -e docker \
      -a eval.harbor.guada_agent:GuaDaAgent \
      -m <providerId:modelName> \
      --ak base_url=http://127.0.0.1:3000/api/v1 \
      --ak agent_id=code-analyst \
      -l 1 -k 1 -n 1 -o <jobs_dir> --job-name guada-smoke

前置：GuaDa 后端已在 base_url 上运行（`pnpm --dir backend-ts run start:dev`）。
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class GuaDaOptions(BaseModel):
    """`--ak key=value` 可传的选项。"""

    model_config = ConfigDict(extra="forbid")

    base_url: str = Field(
        default="http://127.0.0.1:3000/api/v1",
        description="GuaDa 后端 API 基址",
    )
    agent_id: str = Field(
        default="code-analyst",
        description="GuaDa 智能体 id（= ~/.guada-dev/agents 下的目录名）",
    )
    userdata_dir: str = Field(
        default="",
        description="GuaDa 用户数据目录（读会话轨迹用）；留空则取 USERDATA_DIR 或 ~/.guada-dev",
    )
    container: str = Field(
        default="",
        description="容器名或 ID；留空则按 Harbor session_id 自动推导",
    )
    container_path: str = Field(
        default="/app",
        description="容器内工作目录（相对路径的解析基准）",
    )
    perm: str = Field(default="unrestricted", description="readonly | workspace | unrestricted")
    connection_name: str = Field(
        default="",
        description="GuaDa 侧的连接名（= 工具 workspace 参数值）；留空则按容器名自动生成"
        "——**并发 trial 必须唯一**，否则会互相清理对方的连接",
    )
    turn_timeout_sec: int = Field(default=1800, description="单轮对话墙钟上限（秒）")
    poll_interval_sec: float = Field(default=3.0, description="轨迹轮询间隔")
    keep_session: bool = Field(default=False, description="跑完保留连接与会话（调试用）")
    frontend_url: str = Field(
        default="",
        description="GuaDa 前端地址（如 http://localhost:5173）；填了就在日志里打印该会话的直达链接",
    )


def _http(method: str, url: str, body: dict | None = None, token: str | None = None,
          timeout: float = 60.0):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {url} -> {exc.code} {raw[:400]}") from None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _sanitize_project_name(name: str) -> str:
    """与 Harbor 的 _sanitize_docker_compose_project_name 保持一致。"""
    name = name.lower()
    if not re.match(r"^[a-z0-9]", name):
        name = "0" + name
    return re.sub(r"[^a-z0-9_-]", "-", name)


def _docker_ps_names(filter_substr: str) -> list[str]:
    try:
        out = subprocess.run(
            ["docker", "ps", "--filter", f"name={filter_substr}", "--format", "{{.Names}}"],
            capture_output=True, text=True, timeout=30,
        )
        return [n for n in out.stdout.split() if n]
    except Exception:
        return []


class GuaDaAgent(BaseAgent):
    options_model = GuaDaOptions

    @staticmethod
    def name() -> str:
        return "guada"

    def version(self) -> str | None:
        return "0.6.0"

    # ── 内部：HTTP 包装 ────────────────────────────────────────
    async def _api(self, method: str, path: str, body: dict | None = None):
        url = f"{self.options.base_url.rstrip('/')}{path}"
        return await asyncio.to_thread(_http, method, url, body, self._token)

    @property
    def _userdata_dir(self) -> Path:
        if self.options.userdata_dir:
            return Path(self.options.userdata_dir)
        env = os.environ.get("USERDATA_DIR")
        return Path(env) if env else Path.home() / ".guada-dev"

    # ── 容器标识解析 ───────────────────────────────────────────
    def _resolve_container(self, environment: BaseEnvironment) -> str:
        if self.options.container:
            return self.options.container
        session_id = getattr(environment, "session_id", "") or ""
        project = _sanitize_project_name(session_id)
        # compose v2 命名：<project>-<service>-1；Harbor 主服务名为 "main"
        expected = f"{project}-main-1"
        candidates = [expected] + [n for n in _docker_ps_names(project) if n != expected]
        for name in candidates:
            if name:
                self.logger.info("容器候选：%s", name)
                return name
        raise RuntimeError(
            f"未能定位任务容器（session_id={session_id!r}, project={project!r}）；"
            "可用 --ak container=<名字> 显式指定"
        )

    # ── setup：建连接 + 建会话 ─────────────────────────────────
    async def setup(self, environment: BaseEnvironment) -> None:
        # 登录（免密模式下不强制）
        self._token = None
        try:
            r = await asyncio.to_thread(
                _http, "POST", f"{self.options.base_url.rstrip('/')}/auth/auto-login", {}
            )
            self._token = (r or {}).get("access_token") or (r or {}).get("token")
        except Exception as exc:  # noqa: BLE001
            self.logger.warning("自动登录不可用，按免密继续：%s", exc)

        container = self._resolve_container(environment)
        # 连接名按 trial 唯一：并发 trial 若同名，会互相"清理残留"把对方正在用的连接删掉
        self._conn_name = self.options.connection_name or f"harbor-{container}"
        self.logger.info("附着容器：%s（路径 %s，连接名 %s）",
                         container, self.options.container_path, self._conn_name)

        # 同名残余先清理（连接名唯一，重名会 500）——只可能来自同一 trial 的重跑
        existing = await self._api("GET", "/remote-workspace/connections")
        rows = existing if isinstance(existing, list) else (existing or {}).get("connections", [])
        for c in rows or []:
            if c.get("name") == self._conn_name:
                await self._api("DELETE", f"/remote-workspace/connections/{c['id']}")
                self.logger.info("清理同名残留连接 %s", c["id"])

        # 容器内工作目录不存在时退回 "/"（GuaDa 会显式校验该目录）
        path = self.options.container_path
        for attempt_path in (path, "/"):
            try:
                conn = await self._api(
                    "POST",
                    "/remote-workspace/connections",
                    {
                        "name": self._conn_name,
                        "config": {
                            "kind": "docker",
                            "container": container,
                            "path": attempt_path,
                            "perm": self.options.perm,
                        },
                    },
                )
                path = attempt_path
                break
            except RuntimeError as exc:
                if attempt_path == "/":
                    raise
                self.logger.warning("路径 %s 不可用，回退 /：%s", attempt_path, exc)

        self._connection_id = (conn or {}).get("id")
        if not self._connection_id:
            raise RuntimeError(f"连接创建失败：{conn}")
        self.logger.info("连接已建：%s (%s)", self._conn_name, self._connection_id)

        host_workspace = Path(self.logs_dir) / "guada-workspace"
        host_workspace.mkdir(parents=True, exist_ok=True)

        session = await self._api(
            "POST",
            "/sessions",
            {
                "agentId": self.options.agent_id,
                "title": f"harbor {self.name()} {time.strftime('%H:%M:%S')}",
                "modelId": self.model_name,
                "workspacePath": str(host_workspace),
                "settings": {
                    "sandboxMode": "danger-full-access",
                    "planEnabled": False,
                    "attachments": {"ssh-connection": [self._connection_id]},
                },
            },
        )
        self._session_id = (session or {}).get("id")
        if not self._session_id:
            raise RuntimeError(f"会话创建失败：{session}")
        self.logger.info("会话已建：%s（模型 %s，工作区 %s）",
                         self._session_id, self.model_name, path)
        if self.options.frontend_url:
            self.logger.info("实时界面（边跑边看）：%s/chat/%s",
                             self.options.frontend_url.rstrip("/"), self._session_id)
        # 供外部脚本读取（watch.sh 据此自动打开界面）
        try:
            (Path(self.logs_dir) / "session-url.txt").write_text(
                f"{self.options.frontend_url.rstrip('/')}/chat/{self._session_id}\n",
                encoding="utf-8",
            )
        except Exception:  # noqa: BLE001
            pass

    # ── 轨迹 ───────────────────────────────────────────────────
    def _transcript_blocks(self) -> list[dict]:
        if not self._session_id:
            return []
        d = self._userdata_dir / "sessions" / self._session_id
        if not d.is_dir():
            return []
        blocks: list[dict] = []
        for f in sorted(d.glob("*.jsonl")):
            for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
                if not line.strip():
                    continue
                try:
                    blocks.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return blocks

    async def _turn_running(self) -> bool | None:
        """查询会话流是否在跑（failed → None）。用于感知"界面上手动停止"。"""
        try:
            r = await self._api("GET", f"/chat/stream/{self._session_id}/status")
            if isinstance(r, dict) and "isRunning" in r:
                return bool(r["isRunning"])
        except Exception:  # noqa: BLE001
            return None
        return None

    async def _wait_for_turn_end(self) -> str:
        """等一轮结束，并返回结束原因。

        两条信号并用：
        - 轨迹出现 `turn/finish` → 结束，原因取它的 `finishReason`
          （`stop` = 模型自然结束；`user_cancel` = **在 GuaDa 界面上点了停止**）
        - 状态接口 `isRunning` 由 true 变 false → 外部中止的兜底（轨迹还没落盘时）
          `saw_running` 是为了避开"刚 POST 还没起来时 isRunning 也是 false"的竞态。
        """
        deadline = time.time() + self.options.turn_timeout_sec
        saw_running = False
        while time.time() < deadline:
            finish_reason = await asyncio.to_thread(self._turn_finish_reason)
            if finish_reason is not None:
                return finish_reason
            running = await self._turn_running()
            if running is True:
                saw_running = True
            elif running is False and saw_running:
                self.logger.info("检测到外部停止（界面上手动中止）")
                return "stopped-externally"
            await asyncio.sleep(self.options.poll_interval_sec)
        return "timeout"

    def _turn_finish_reason(self) -> str | None:
        """轨迹里最后一个 turn/finish 的 finishReason（没有则 None）。"""
        for b in reversed(self._transcript_blocks()):
            if b.get("type") == "turn/finish":
                return (b.get("data") or {}).get("finishReason") or "completed"
        return None

    # ── run：驱动一轮对话 ──────────────────────────────────────
    async def run(self, instruction: str, environment: BaseEnvironment,
                  context: AgentContext) -> None:
        try:
            await self._api(
                "POST",
                "/chat/stream",
                {"sessionId": self._session_id, "userMessage": {"content": instruction}},
            )
            self.logger.info("指令已提交，等待一轮结束…")
            status = await self._wait_for_turn_end()
            self.logger.info("一轮结束：%s", status)
            if status == "timeout":
                try:
                    await self._api("POST", f"/chat/stream/{self._session_id}/stop", {})
                except Exception as exc:  # noqa: BLE001
                    self.logger.warning("stop 失败：%s", exc)

            # 轨迹落到 trial 目录，便于事后诊断
            try:
                blocks = await asyncio.to_thread(self._transcript_blocks)
                out = Path(self.logs_dir) / "guada-transcript.jsonl"
                out.write_text("\n".join(json.dumps(b, ensure_ascii=False) for b in blocks),
                               encoding="utf-8")
                calls = sum(
                    1 for b in blocks
                    if b.get("type") == "assistant/message"
                    for c in (b.get("data", {}).get("content") or [])
                    if c.get("type") == "tool-call"
                )
                self.logger.info("轨迹已导出：%s（工具调用 %d 次）", out, calls)
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("轨迹导出失败：%s", exc)

        finally:
            await self._teardown()

    async def _teardown(self) -> None:
        if self.options.keep_session:
            self.logger.info("--ak keep_session=true：保留连接 %s 与会话 %s",
                             getattr(self, "_connection_id", None),
                             getattr(self, "_session_id", None))
            return
        for path in (
            f"/sessions/{getattr(self, '_session_id', None)}" if getattr(self, "_session_id", None) else None,
            f"/remote-workspace/connections/{getattr(self, '_connection_id', None)}"
            if getattr(self, "_connection_id", None) else None,
        ):
            if not path:
                continue
            try:
                await self._api("DELETE", path)
            except Exception as exc:  # noqa: BLE001
                self.logger.warning("清理 %s 失败：%s", path, exc)

    # ── 上报用量 ───────────────────────────────────────────────
    def populate_context_post_run(self, context: AgentContext) -> None:
        try:
            blocks = self._transcript_blocks()
        except Exception:  # noqa: BLE001
            return
        inp = out = cache = 0
        seen = False
        for b in blocks:
            if b.get("type") != "turn/finish":
                continue
            d = b.get("data") or {}
            seen = True
            inp += int(d.get("promptTokens") or 0)
            out += int(d.get("completionTokens") or 0)
            cache += int(d.get("cachedTokens") or 0)
        if seen:
            context.n_input_tokens = inp
            context.n_output_tokens = out
            context.n_cache_tokens = cache
