# 桌宠测试脚本

## 常规测试（可以随时跑，不打扰使用电脑）

| 命令 | 说明 |
|---|---|
| `pnpm test:pet-window` | 纯函数：路径解析、位置夹取、缩放 |
| `pnpm test:pet-import` | 导入素材目录（临时目录，不碰真实数据） |
| `pnpm test:pet-state` | 主进程 → 桌宠的状态透传字段完整性 |
| `pnpm test:pet-uninstall` | 卸载的安全边界（内置保护 / 路径穿越 / 只读目录） |
| `pnpm test:pet-atlas` | 图集几何、行契约 |
| `pnpm test:pet-window:electron` | 真实 BrowserWindow：尺寸/位置/穿透几何 |
| `pnpm test:pet-controller:electron` | 控制器：缩放夹取、形象切换 |
| `pnpm test:pet-atlas:electron` | atlas 端到端：播放、mood 映射、切格尺寸 |
| `pnpm test:pet-click-through:electron` | 透明区穿透（合成事件，不动真实鼠标） |
| `pnpm test:pet-ignore:electron` | 穿透开关语义（心跳放开 / hitLeave 回穿透） |
| `pnpm test:pet-heartbeat:electron` | 命中心跳 TTL |
| `pnpm test:pet-stale-drag:electron` | 残留 pointer capture 的清理 |
| `pnpm test:pet-resume:electron` | 唤醒/隐藏后的状态自愈 |

## ⚠️ 手动测试（会抢占鼠标，不要自动跑）

这两个脚本用 Windows `SendInput`/`mouse_event` **注入真实鼠标事件**——
运行期间会真的移动光标、按下抬起，抢走你的鼠标操作。

只在专门排查「点了没反应 / 拖不动」这类输入问题时手动执行：

| 命令 | 说明 |
|---|---|
| `pnpm manual:pet-real-drag` | 真实点击 → 渲染层收到 pointerdown → 拖动使窗口移动 |
| `pnpm manual:pet-unlock-drag` | 模拟 WIN+L（hide→show）后仍能拖动 |

文件名前缀 `manual-` 即标记。**新增这类脚本请沿用该前缀**，
并保持只在 `manual:` 命令下暴露，不要挂进 `test:` 或 CI。

## 为什么需要真实输入

合成事件（`dispatchEvent(new PointerEvent(...))`）会绕过 Windows 的命中测试，
测不出以下问题——这些正是历史上反复踩的坑：

- `focusable: false` 导致 `MA_NOACTIVATEANDEAT` 吃掉 mousedown
- layered 窗口按像素 alpha 做命中测试（透明像素点击穿透）
- `hide→show` 后窗口表面失效（所有像素 alpha 归零，点击全穿透）
