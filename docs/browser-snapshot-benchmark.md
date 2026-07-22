# 浏览器快照实测报告

测试日期：2026-07-22  
测试平台：Windows / Electron 41 / Chromium 内核  
测试实现：`Accessibility.getFullAXTree` + AX 语义压缩 + `backendDOMNodeId` ref 写回

## 快照类型

| 类型 | AI 输出 | 默认 | 用途 |
|---|---|---:|---|
| `simple` | 精简无障碍树 YAML | 是 | 浏览、定位、点击和输入 |
| `struct` | 详细 DOM role/ref 树 JSON | 否 | 无障碍语义遗漏元素时排查 |
| `summary` | 文本、标题和链接摘要 | 否 | 阅读页面主要内容 |

## 测试方式

### 纯转换测试

命令：

```powershell
npm run test:browser-snapshot:unit
```

覆盖项：

- ignored/generic 容器压平
- AX role/name 转换
- 仅可交互 DOM 节点生成 ref（包括无标签控件）
- 普通可见文本保留且去除 InlineTextBox 重复
- combobox/listbox 等复合控件保留 option 子项
- checked/selected/expanded/value 状态保留
- 节点预算与省略标记
- 旧 DOM struct 回退压缩

结果：8/8 通过。

### Electron fixture 集成测试

命令：

```powershell
npm run test:browser-snapshot:fixture
```

fixture 包含多层 `div`、导航链接、标题、正文、按钮、textarea、select/options、ARIA checkbox、Shadow DOM 按钮和隐藏按钮。测试通过真实 Electron `WebContents.debugger` 获取 AX 树，并验证 ref 被写回 DOM。

| 指标 | struct | simple |
|---|---:|---:|
| 输出字符数 | 3,351 | 974 |
| 节点数 | 28 | 16 |
| 最大深度 | 5 | 3 |
| 获取耗时 | 23 ms | 15 ms |
| 相对 struct 字符减少 | - | **70.93%** |

交互与边界验证：

- `button "提交"` → `e3`，点击成功
- `textbox "搜索内容"` → `e4`，带引号、反斜杠和换行的输入及 input 事件成功
- 普通可见正文保留
- select 的两个 option 子项和状态保留
- 隐藏按钮未出现在 simple 树
- Shadow DOM 控件保留语义但不生成当前 API 无法使用的顶层 ref
- CDP 完成后 debugger 已释放
- debugger 已被占用时自动切换 DOM fallback，且不会断开外部 debugger
- 9 个顶层可交互 ref 成功写入真实 DOM

fixture 的 simple 输出：

```yaml
role: document
name: Accessibility Snapshot Fixture
ref: root
children:
  - role: navigation
    name: 主导航
    children:
      - role: link
        name: 首页
        ref: e0
      - role: link
        name: 番剧
        ref: e1
      - role: link
        name: 直播
        ref: e2
  - role: main
    children:
      - role: heading
        name: 快照测试页面
      - role: text
        name: 这是一段普通可见正文
      - role: button
        name: 提交
        ref: e3
      - role: textbox
        name: 搜索内容
        ref: e4
      - role: combobox
        name: 主题
        value: 浅色
        ref: e5
        children:
          - role: option
            name: 浅色
            selected: true
            ref: e6
          - role: option
            name: 深色
            selected: false
            ref: e7
      - role: checkbox
        name: 记住设置
        checked: true
        ref: e8
```

## Bilibili 首页实测

命令：

```powershell
npm run test:browser-snapshot:bilibili
```

页面：`https://www.bilibili.com/`  
页面标题：`哔哩哔哩 (゜-゜)つロ 干杯~-bilibili`

> 页面内容、推荐列表和网络状态会动态变化，数字为本次实测值。

| 指标 | 原 HTML | struct | simple |
|---|---:|---:|---:|
| 字符数 | 335,367 | 288,351（格式化 JSON） | 4,631（YAML） |
| 节点数 | - | 982 | 90 |
| 最大深度 | - | 16 | 2 |
| 原始 AX 节点数 | - | - | 906 |
| 可交互 ref 数 | - | - | 68 |
| 获取耗时 | - | 43 ms | 452 ms |

结果：

- simple 相对 struct 字符减少 **98.39%**
- 最大深度从 16 降至 2
- 首页顶部导航得到连续 ref：`首页=e0`、`番剧=e1`、`直播=e2` 等
- 搜索框被识别为 `textbox` 并获得 ref
- 大量无名图片、list/listitem 和交互控件内部视觉子节点已被移除

输出前段：

```yaml
role: document
name: 哔哩哔哩 (゜-゜)つロ 干杯~-bilibili
ref: root
children:
  - role: link
    name: 首页
    ref: e0
  - role: link
    name: 番剧
    ref: e1
  - role: link
    name: 直播
    ref: e2
  - role: link
    name: 游戏中心
    ref: e3
  - role: link
    name: 会员购
    ref: e4
  - role: textbox
    name: 情报马
    ref: e8
```

## 结论

- AX 树方案可在当前 Electron webview 架构中工作。
- `backendDOMNodeId` 可稳定映射回真实 DOM，现有 `browser_interact` 的 `[data-ai-ref]` 链路无需重写。
- simple 快照对大型页面的 token 压缩非常明显，适合作为默认类型。
- AX 树依赖页面无障碍语义；自定义可点击 `div` 可能缺失，因此保留 `struct` 作为手动回退。
- DevTools 占用 debugger 或 CDP 调用失败时，服务会自动使用旧 DOM struct 压缩为 simple 树。

## 后端是否可独立测试

可以独立测试的部分：

- 工具 schema 与默认 `simple`
- simple YAML / struct JSON / summary 文本格式化
- Bridge 请求参数和失败异常传播
- AX 节点到 simple 树的纯转换逻辑（无需启动 Nest 或 Electron）

不能仅靠独立后端验证的部分：

- Chromium `Accessibility.getFullAXTree`
- `backendDOMNodeId` 到真实 DOM 的映射
- ref 点击和输入是否命中元素

这些部分必须由 Electron 集成测试覆盖；测试不需要启动 Nest Backend。
