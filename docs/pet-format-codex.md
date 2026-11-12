# Codex 桌宠素材格式（契约）

> 目的：让 GuaDa 桌宠**原生**支持 Codex 生态的宠物（hatch-pet 产物、Petdex 社区宠物），
> 同时保留我们自己的逐帧格式。两种格式在运行时等价，由渲染层的 Provider 屏蔽差异。
>
> 本文是**我们自己的契约副本**（不依赖外部链接），校验脚本
> `scripts/validate-pet-atlas.mjs` 与渲染层 `AtlasProvider` 都以本文为准。

## 1. 目录结构

一只 Codex 宠物 = 一个目录、两个文件：

```
<pet-dir>/
├── pet.json            # 清单
└── spritesheet.webp    # 图集（无损 WebP；也接受 PNG）
```

目录名即宠物 id（设置页选择器用它做 key）。

### pet.json

```json
{
  "id": "qi",
  "displayName": "柒",
  "description": "一只银发少女桌宠",
  "spritesheetPath": "spritesheet.webp"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 标识符。实际以**目录名**为准，此字段只做自检 |
| `displayName` | 是 | 设置页显示名 |
| `description` | 否 | 一句话描述 |
| `spritesheetPath` | 是 | 图集文件名（同目录内） |

## 2. 图集几何（硬约束）

| 项 | 值 |
|---|---|
| 画布 | **1536 × 1872** px |
| 网格 | **8 列 × 9 行** |
| 单格 | **192 × 208** px |
| 底色 | 全透明 |
| 未使用格 | 必须**完全透明**（alpha = 0） |

格子坐标：第 `r` 行第 `c` 列的左上角为 `x = c * 192`, `y = r * 208`。

## 3. 行契约（顺序固定，不可调换）

| 行 | 状态 | 帧数 | 逐帧时长（ms） |
|---|---|---|---|
| 0 | `idle` | 6 | 280, 110, 110, 140, 140, 320 |
| 1 | `running-right` | 8 | 120 ×7, 220 |
| 2 | `running-left` | 8 | 120 ×7, 220 |
| 3 | `waving` | 4 | 140 ×3, 280 |
| 4 | `jumping` | 5 | 140 ×4, 280 |
| 5 | `failed` | 8 | 140 ×7, 240 |
| 6 | `waiting` | 6 | 150 ×5, 260 |
| 7 | `running` | 6 | 120 ×5, 220 |
| 8 | `review` | 6 | 150 ×5, 280 |

> 时长是**格式的一部分**（不是每只宠物可调的 fps）。我们的 `AtlasProvider` 按此表推进帧；
> 全局 `animationSpeed` 只做整体倍速。

### 语义

| 状态 | 含义 | 禁止 |
|---|---|---|
| `idle` | 待机呼吸/眨眼 | 大幅动作、道具交互、新道具 |
| `running-right` / `running-left` | **横向移动**（我们用于拖动桌宠） | 速度线、尘土、落地阴影 |
| `waving` | 打招呼/启动 | 挥手波纹、符号、特效 |
| `jumping` | 起跳（未启用，保留） | 落地标记、冲击波 |
| `failed` | 出错/沮丧 | 漂浮的符号、脱离本体的泪滴 |
| `waiting` | **等待用户确认/输入** | 与 idle 难以区分 |
| `running` | **正在干活**（思考/编码/跑命令） | 真的跑步（那是 running-right 的活） |
| `review` | 收尾/检查 | 放大镜、纸张、UI 等新道具 |

## 4. 透明与像素规则

1. 未使用格 alpha 必须为 0；
2. **透明像素不得残留 RGB**（alpha=0 时 r=g=b=0）——否则缩放后会出现彩色描边；
3. 一格内只放一个完整姿态，不允许跨格；被裁掉的身体部位视为失败；
4. 不做脱离本体的特效（星星、烟雾、速度线、阴影）。

校验脚本对 1、2 做硬校验，3、4 只能人工/视觉 QA。

## 5. 我们的另一种格式（frames，保留）

```
<pet-dir>/
├── manifest.json     # 动画索引（含每段 bbox，命中判定用）
├── avatar.webp       # 设置页预览图
└── <anim>/frame_001.webp …
```

由 `scripts/bake-pet-assets.mjs` 从美术侧 `animations/`（manifest + anim.json + 三位补零帧）
烘焙生成；状态为 idle / walk / run / yawn 四段，每段一个 fps。

## 6. 两种格式的识别与优先级

1. 素材根（按优先级）：`<userData>/pets/`（用户导入） → `build-resources/pets/`（内置）
2. 同一 id 出现在多个根时，**前面的根胜出**
3. 目录内：有 `pet.json` → atlas；有 `manifest.json` → frames；都没有 → 跳过（日志警告）

## 7. 与 Codex 的差异（我们更强的地方，刻意保留）

| 点 | Codex | 我们 |
|---|---|---|
| 窗口 | Neutralino，**底部约 20% 收不到指针**（上游 bug） | Electron 透明窗 + 40ms 光标轮询，全窗可交互 |
| 命中判定 | 无（整窗可点，会挡住桌面） | 按当前 clip 的 alpha 包围盒判定，透明区穿透 |
| 气泡 | 无 | 任务/未读/待答列表 |

这些是**窗口层**能力，与素材格式无关；接入 Codex 宠物时同样生效。
