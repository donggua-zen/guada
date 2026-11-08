# Computer Use 架构调研：Qoder 参考实现 vs GuaDa

> 调研方法：对本机安装的参考项目（`~/.qoder-cn/bin/qoder-cn-computer-use/QoderComputerUse.exe` v2.2.13）
> 做 strings 逆向，提取其 MCP 协议、工具面、错误码与状态模型；再对照 GuaDa 现有
> `guada-computer` sidecar + `ComputerPlugin` 栈，落地差距项。
>
> 命名规则：以下分析中不出现参考项目的可执行名以外的品牌信息；产品代码与文档统一
> 使用 `guada-*` 前缀（见 `docs/COMPUTER_USE.md`）。

## 一、参考实现的架构原理

### 1. 进程模型
- 独立 Rust 二进制（约 2.5MB），以 **MCP（Model Context Protocol）stdio 服务**形式运行：
  `initialize`（protocolVersion 2024-11-05）/ `tools_list` / tool call 三段式握手，
  与宿主通过 JSON-RPC 逐行通信。GuaDa 采用的是自定义 NDJSON JSON-RPC（`method`
  命名空间式路由），本质相同，且无 MCP 握手开销。
- 与 Qoder 的分发方式一致：宿主把二进制作为 **shared-binary 资源**下载/更新到
  `~/.qoder-cn/bin/`（见 `bundled-resources/v1/state.json`：`kind: "shared-binary"`，
  带 `archiveSha256` 与版本锁），GuaDa 对应 `sidecar.lock.json` +
  `build-resources/computer-sidecar/`。两者都"版本锁定、运行时不下载"之外，
  Qoder 走 CDN 增量更新（revision 字段），GuaDa 走随包分发。

### 2. 工具面（14 个）
参考实现按"发现 → 观察 → 操作 → 验证"分层：

| 层 | 工具 | 说明 |
| --- | --- | --- |
| 发现 | `list_apps` / `list_windows` / `launch_app` | list_apps 来自 Windows Apps Folder（AppsFolderEntry：id/displayName/app_model_id/shell_path）；launch_app 解析顺序：app-paths-registry → start-menu-shortcut → uninstall-registry → windows-apps-alias → explicit-path |
| 窗口 | `get_window` / `activate_window` / `get_window_state` | get_window_state 一次返回截图 + UIA 树（可分开 include_screenshot/include_text），带 snapshotRevision/screenshotRevision |
| 操作 | `click` / `drag` / `scroll` / `type_text` / `press_key` / `set_value` / `perform_secondary_action` | click 支持 element_index（UIA 语义）或 x/y（窗口相对截图坐标）；set_value 走 ValuePattern（只读检测 → element_not_editable）；perform_secondary_action 暴露 Invoke/Toggle/Expand/Collapse 等 Secondary Actions |
| 批处理 | `run_steps` | 有序工具调用序列，自动携带 window/screenshotId/accessibilityRevision，支持 target 解析（app_filter/window_title_filter/launch_if_missing）、element_text 精确匹配、post_action_state、final_state 期望文本校验（final_state_expect_text + 轮询） |

### 3. 状态一致性模型（与 GuaDa lease 同构但更细）
- 三代 revision：**snapshotRevision**（UIA 快照）、**screenshotRevision**（截图）、
  accessibilityRevision（元素索引作用域）。GuaDa 对应 capture/window/snapshot 三个
  generation + 后端 lease registry。
- 陈旧错误码细分：`element_stale`（runtimeId/身份校验失败）、`screenshot_stale`
  （未知 screenshotId）、`target_stale`（窗口身份/边界变化，可 refetch 重试）。
  GuaDa 统一为 `STALE_REFERENCE` + 提示重新 observe。
- 元素定位三通道：element_index（快照作用域）→ element_text（要求先
  `get_window_state(include_text:true)`，必须唯一匹配，多个/零个都报错）→ x/y。
  错误提示明确："element_text matched multiple accessibility elements; make the
  text more specific"。

### 4. 值得吸收的工程点
- **element_text 语义定位**：模型不必记住 ref 数字，直接用可见文本点元素；要求
  "必须恰好唯一匹配"防止误点。
- **set_value 原生写值**：ValuePattern/LegacyIAccessible 双通道，read_only 前置检测，
  失败回落 verified type_text。
- **run_steps 批处理**：一次调用完成"解析窗口 → 激活 → 多步操作 → final_state
  校验"，把 4-6 次模型往返压缩为 1 次，并允许 target_stale 自动 get_window 重试一次
  （输入动作从不自动重试——与 GuaDa 的 UNCERTAIN 语义一致）。
- **窗口相对坐标**：click/drag/scroll 全部使用"窗口相对截图坐标"，由 sidecar 负责
  映射，天然规避多显示器负坐标。GuaDa 目前是"显示器截图坐标"。
- **launch_app 的 app id 解析链**：优先接受 list_apps 返回的稳定 id，而不是裸路径。

## 二、GuaDa 现状（本次改造前）

`guada-computer` sidecar v0.1.0（Rust，UIA 0.25 + windows-rs 0.61）已有：
- 观察：screenshot（GDI + 自适应降采样，1568px/1.5MB 上限）、cursor_position、
  list_windows、a11y.observe（控制视图walker + 可操作元素过滤，node_budget=120）
- 操作：click_element（Invoke/Toggle/SelectionItem/ExpandCollapse/Legacy 五模式 +
  UNSUPPORTED 时验证式像素回落）、像素点击五变体、type（KEYEVENTF_UNICODE）、
  key（组合键解析）、scroll、focus_window（四段式前台解锁）
- 安全：observe-lease（三代 generation）、元素五重活性校验（runtimeId→窗口→边界→
  祖先链→命中测试→复检）、UNCERTAIN 语义、UIPI 不绕过、密码字段不投影
- 后端：ComputerPlugin（3 工具 + 审批卡 + policy 14 键）、lease.ts、policy.ts

## 三、差距分析 → 本次落地

| 参考能力 | GuaDa 改造前 | 本次决策 |
| --- | --- | --- |
| `type_text` 之外的 `set_value` 原生写值 | 无（只能逐字符 type） | ✅ 新增 `input.action=set_value`，走 UIA ValuePattern，read-only/密码前置拒绝 |
| `element_text` 语义定位 | 只有 ref 数字 | ✅ `click_element`/`set_value` 支持 `element_name`，快照内 name/value 子串匹配，0 个或多个匹配报 NOT_FOUND 并列出 refs |
| `drag` | 无 | ✅ 新增 `input.action=drag`（x,y → to_x,to_y，8 步插值移动，失败 UNCERTAIN 并确保松开左键） |
| `launch_app` | 无（roadmap 明确排除） | ✅ 新增独立方法 `launch_app` + 工具 `computer_launch`；仅接受绝对路径（比参考实现的 app-id 链保守，避免解析 Start Menu 注册表的复杂度），路径规范化 + 文件校验 + ShellExecuteW，成功后清空观察 |
| `run_steps` 批处理 | 无 | ⏸ 不做：需要重写 state 层的窗口/快照绑定，收益主要是降低往返次数；列入 roadmap |
| 窗口相对坐标 | 显示器坐标 | ⏸ 保留现有显示器截图坐标体系（与 lease/文档/前端文案一致），列入 roadmap |
| `perform_secondary_action` | 部分覆盖：perform_press 已含 Invoke/Toggle/Select/Expand/Legacy | ⏸ 现有五模式已覆盖绝大多数场景 |
| `list_apps`（应用级发现） | 只有 list_windows | ✅ 新增 observe `list_apps`：按 pid 聚合可见窗口（app/pid/window_id/window_count/focused），未做 AppsFolder 目录解析（保持 launch 仅路径的保守语义） |

## 四、本次改动清单

Sidecar（`guada-computer/`）：
- `crates/core/src/input.rs`：新增 `drag()`（含路径插值与 UNCERTAIN 释放保证）
- `crates/core/src/window.rs`：新增 `launch_app()`（ShellExecuteW，code<=32 报错细分）
- `crates/a11y/src/engine.rs`：`A11yEngine` 新增 `find_by_name()` 默认实现
- `crates/a11y/src/windows_backend/actor.rs`：ElementRecord 保存 name/value；
  `FindByName` 命令；快照内大小写不敏感子串匹配
- `crates/sidecar/src/rpc.rs`：`input` 新增 `set_value`/`drag` 分支；`click_element`
  支持 `element_name`；新增 `launch_app` 方法；`observe` 新增 `list_apps` 分支
- `crates/core/src/window.rs`：新增 `list_apps()`（按 pid 聚合 `list_windows` 输出）

Electron 接线（阶段二补齐）：
- `electron/computer-sidecar-client.ts`：dispatch 新增 `launch_app` 分支（15s 超时）
- `electron/main.ts`：注册 `launch_app` bridge handler

后端（`backend-ts/`）：
- `builtins/computer-use/policy.ts`：新增 `set_value`/`drag`/`launch_app` 三个策略键（默认 ask）
- `builtins/computer-use/lease.ts`：`set_value`→accessibility，`drag`→screenshot
- `builtins/computer.plugin.ts`：`computer_input` schema 扩展（element_name/to_x/to_y/
  set_value/drag 校验）；新增 `computer_launch` 工具（审批 + launch_app 策略门）；
  工作流提示词更新（set_value 优先、名称匹配、launch 用法）
- `computer.lang.zh.json` / `computer.lang.en.json`：`computer_launch.*` 文案

前端（`frontend/`）：
- `src/utils/computerUse.ts`：同步三个策略键（设置页 actionRows 自动展开）
- `src/locales/zh-CN/settings.ts` / `en-US/settings.ts`：新动作标签与描述

测试：
- `backend-ts/test/plugins/computer.plugin.spec.ts`：工具数 3→4
- cargo 测试 27 个通过；`node scripts/test-computer-sidecar.js` 通过；
  jest 16 个通过；vitest 4 个通过

## 五、验证方式

```bash
cd guada-computer && build.bat test --workspace
node /tmp/smoke-new.cjs            # 新 RPC 方法错误码冒烟（STALE_REFERENCE/UNSUPPORTED/NOT_FOUND）
pnpm run verify:sidecar            # 二进制 hash 与锁文件一致
pnpm run test:computer-sidecar
pnpm --dir backend-ts exec jest test/computer test/plugins/computer.plugin.spec.ts --runInBand
pnpm --dir frontend exec vitest run src/utils/computerUse.test.ts
```

桌面端端到端：启用 Computer Use → 让智能体"打开记事本，用 set_value 写入文本，
按名称点击菜单，拖拽一个滑块"，观察审批卡与策略生效。
