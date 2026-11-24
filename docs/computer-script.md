# Computer Script（脚本化桌面自动化）

> 当前唯一桌面自动化入口：旧扁平 `computer_*` 工具已退役，`computer_run` 是替代入口。
> 完整模型 API 指南注册为 `computer-use` 技能，脚本编写前用
> `skill_learn("computer-use")` 按需加载。底层 `guada-computer` sidecar 协议未变。

## 设计

`computer_run` 里运行一段 JavaScript，模型通过 `computer.*` 编排桌面操作：

- 观察用 `computer.screenshot()` / `computer.a11y()` / `computer.windows()` /
  `computer.apps()` / `computer.cursor()`。
- 动作用 `computer.click()` / `setValue()` / `type()` / `key()` / `scroll()` /
  `focusWindow()` / `move()` / `drag()` / `launch()`。
- 观察返回 generation；运行时**自动**把它带到下一次 input，模型不需要手写
  `expected_generation`。
- 任何 input 都会清空观察租约；下一次 input 前必须重新观察。这与旧工具语义一致，
  但由运行时统一执行，避免模型漏传 generation。
- 脚本可以循环、条件判断、在脚本内重新观察；一次调用完成多步操作。

## 架构

```
LLM
 → computer_run（computer 工具包，eager）
 → ComputerScriptRuntime（NestJS 后端）
 → Worker + vm（模型脚本执行，可强制终止）
 → BridgeClient（Named Pipe / UDS）
 → Electron BridgeServer
 → ComputerSidecarClient
 → guada-computer --stdio（Windows UIA/GDI/SendInput，macOS AX/CGEvent）
```

## 文件

| 作用 | 位置 |
|---|---|
| 工具注册、策略/审批、桌面锁、截图落盘 | `backend-ts/src/modules/plugins/builtins/computer.plugin.ts` |
| 脚本运行时（Worker 生命周期、dispatch、预算、trace） | `backend-ts/src/modules/plugins/builtins/computer-script/computer-script-runtime.ts` |
| 沙箱 bootstrap + `computer` facade | `backend-ts/src/modules/plugins/builtins/computer-script/computer-script.worker.ts` |
| 完整说明书（skill 正文） | `backend-ts/src/modules/plugins/builtins/computer-script/computer-script.skill.ts` |
| 观察租约 | `backend-ts/src/modules/plugins/builtins/computer-use/lease.ts` |
| 动作策略键 | `backend-ts/src/modules/plugins/builtins/computer-use/policy.ts` |
| 进程级桌面锁 | `backend-ts/src/modules/plugins/builtins/computer-use/desktop-lock.ts` |

## Bridge 映射

| 脚本调用 | Bridge 方法 / action | 策略键 | 所需观察 |
|---|---|---|---|
| `computer.screenshot({display?})` | `computer_observe` screenshot | `screenshot` | — |
| `computer.a11y({pid?})` | `computer_a11y_observe` | `a11y_observe` | — |
| `computer.windows()` | `computer_observe` list_windows | `list_windows` | — |
| `computer.apps()` | `computer_observe` list_apps | `list_windows` | — |
| `computer.cursor()` | `computer_observe` cursor_position | — | — |
| `computer.click({ref\|name})` | `computer_input` click_element | `click_element` | accessibility |
| `computer.click({x,y,button?,clicks?})` | left/right/middle/double/triple_click | 对应键 | screenshot |
| `computer.setValue({ref\|name,text})` | `computer_input` set_value | `set_value` | accessibility |
| `computer.type(text)` | `computer_input` type | `type` | 任意 |
| `computer.key(combo)` | `computer_input` key | `key` | 任意 |
| `computer.scroll({direction,amount,x?,y?})` | `computer_input` scroll | `scroll` | 任意；带坐标需 screenshot |
| `computer.focusWindow(id)` | `computer_input` focus_window | `focus_window` | window_list |
| `computer.move(x,y)` | `computer_input` mouse_move | `mouse_move` | screenshot |
| `computer.drag({x,y,toX,toY})` | `computer_input` drag | `drag` | screenshot |
| `computer.launch(path)` | `launch_app` | `launch_app` | — |

`computer.apps()` 不会创建租约；`focusWindow` 需要先 `computer.windows()`。

## 租约与 generation

- 运行时在观察成功后调用 `ComputerLeaseRegistry.record(sessionId, kind, generation)`。
- input 前用 `peek(sessionId)` 校验 kind，并自动填 `expected_generation`；没有租约报
  `NO_OBSERVATION`，kind 不匹配报 `WRONG_OBSERVATION_KIND`。
- input 成功后（以及失败/拒绝后）清租约；`STALE_REFERENCE` / `UNCERTAIN` /
  `PERMISSION_REQUIRED` 也会清租约。
- 跨脚本：最后一次观察若没有被 input 消费，租约保留到下一条脚本；这允许
  “脚本 1 观察 → 脚本 2 动作”。桌面被人改动时由 sidecar 的元素校验兜底。

## 策略、审批与计划模式

- 每次调用先读 `computerUse.actions`（每次动作都重新读，运行中改设置即时生效）：
  - `allow`：直接执行。
  - `ask`：调用 `AskService.requestComputerUseApproval`，卡片选项为“仅本次 /
    本轮内自动放行 / 拒绝”。“本轮内自动放行”后，同一会话本轮后续动作不再弹卡。
  - `deny`：不触达 sidecar，脚本以 `POLICY_DENIED` 终止。
- 用户拒绝或取消会终止整个脚本，而不是只让当前调用失败；模型不会在同一个脚本里继续。
- 无应答面（子代理、Bot）遇到 `ask` 直接 `APPROVAL_UNAVAILABLE` fail-closed；
  `allow` 动作可执行。子代理会话继承父会话的 `settings.plugins/skills`，因此工具
  与技能是否可见沿用现有继承规则。
- 计划模式：工具声明 `allowedInPlanMode: true`，运行时放行观察、拒绝所有
  input/launch（`PLAN_MODE_DENIED`）。工具**不声明** `requiresUserInteraction`：
  该字段只影响计划门，声明后会让计划模式下的子代理连只读观察都被整工具拒绝；
  脚本运行时自己会对 `ask` fail-closed。

## 并发与预算

- 进程内只有一个 sidecar，观察 generation 是全局的。`DesktopLock` 串行化整个脚本
  运行（含审批等待）；第二个脚本等待 15s 后返回 `COMPUTER_BUSY`。
- 整体超时默认 120s、最大 300s；**审批等待不计入超时**（等待期间暂停定时器）。
- 预算：60 个 input/launch、40 次观察、20 张截图、100 步 trace、100 条日志；
  工具结果文本 30k 字符；最多 6 张附图。
- 超时/取消会 terminate worker。Bridge 没有 cancel 协议，已派发的桌面动作可能
  继续完成——skill 里明确写出。

## 沙箱与安全

- `worker_threads` + `vm.createContext`，`codeGeneration: { strings: false, wasm: false }`。
- 全局只有 `computer`、`log`、`sleep`、`args`、`console` 和注入的 timer；
  没有 `require` / `process` / `fs` / `fetch`。
- Worker 内存上限 256MB，同步切片 5s 超时，整体超时后 `terminate()`。
- 截图由 sidecar 写到临时路径，后端读回后交 `SessionImageStore` 转码落会话附件，
  临时文件删除；base64 不进入 worker、meta 或 JSONL。
- trace 与审批 detail 只记录动作类型/元素/字符数，不记录 `type` / `setValue` 的正文。

## 错误码

`SCRIPT_PARSE` / `SCRIPT_ERROR` / `RESULT_UNSERIALIZABLE` / `UNKNOWN_METHOD` /
`UNSUPPORTED` / `INVALID_ARGUMENT` / `NO_OBSERVATION` / `WRONG_OBSERVATION_KIND` /
`STALE_REFERENCE` / `NOT_FOUND` / `UNCERTAIN` / `BACKEND` / `INVALID_REQUEST` /
`PERMISSION_REQUIRED` / `POLICY_DENIED` / `APPROVAL_UNAVAILABLE` /
`PLAN_MODE_DENIED` / `COMPUTER_BUSY` / `ACTION_LIMIT` / `OBSERVATION_LIMIT` /
`SCREENSHOT_LIMIT` / `SCREENSHOT_FAILED` / `TIMEOUT` / `CANCELLED` /
`SIDECAR_UNAVAILABLE` / `UNAVAILABLE` / `CALL_FAILED`。

前五类中的 `STALE_REFERENCE` / `UNCERTAIN` / `NOT_FOUND` / `UNSUPPORTED` /
`INVALID_ARGUMENT` 可由脚本 catch 后自行处理；拒绝、计划模式、预算、超时、
取消、sidecar 不可用会终止脚本。

## 测试

```bash
pnpm --dir backend-ts exec jest \
  test/computer \
  test/plugins/computer.plugin.spec.ts \
  test/plugins/computer-script.runtime.spec.ts \
  --runInBand
pnpm run verify:sidecar
pnpm run test:computer-sidecar
pnpm run test:computer-sidecar:electron
pnpm --dir frontend exec vitest run src/utils/computerUse.test.ts
```

端到端手验见 [COMPUTER_USE.md](./COMPUTER_USE.md#testing)。
