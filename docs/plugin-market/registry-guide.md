# GuaDa 插件市场收录指南(registry guide)

> 面向插件作者与市场维护者:插件如何上架到官网插件市场(`ai.dingd.cn/plugins`)。
>
> 核心原则:**官网只做索引,不托管插件本体**。插件代码放在 GitHub / Gitee / GitCode 等
> git 托管平台的公开仓库,官网收录"名称 / 简介 / 标签 / 截图 / 安装源地址"等元信息,
> 客户端从官网索引浏览后,走内置的 git 协议安装(`github:` / `gitee:` / `git:` / `local:`)。

## 1. 上架前提

插件必须满足 `docs/plugin-market/third-party-plugin-api.md` 的全部契约,额外要求:

| 项 | 要求 |
|---|---|
| 托管 | 公开 git 仓库(GitHub / Gitee / GitCode),**一仓一插件**,manifest.json 在仓库根目录 |
| 入口 | 生产环境必须为纯 JS(CommonJS),零 npm 依赖或仅用 Node 内置模块(宿主通过 `requireWithFallback` 复用后端依赖,但不保证第三方包可用) |
| apiVersion | 不得高于当前宿主 `PLUGIN_API_VERSION`(现为 3) |
| manifest | `id/name/version/description/author/icon` 必填;建议补 `homepage` / `repository` / `license` |
| 图标 | `assets/` 下 SVG 或 PNG(≥128px),manifest `icon` 字段指向 |
| README | 仓库根提供 README.md,含功能介绍、截图、配置说明 |

不收录:依赖宿主源码路径(如相对 import `backend-ts/src/...`)的插件、
修改宿主文件(dist/node_modules 补丁)的插件、category 为 `system` 的内置插件。

## 2. 安装源地址格式

官网索引里的 `source.install` 字段就是客户端安装框可直接粘贴的字符串:

| 形式 | 示例 |
|---|---|
| GitHub | `github:owner/repo` 或 `github:owner/repo#v1.2.0`(分支/tag/commit) |
| Gitee | `gitee:owner/repo#main` |
| 任意 git URL | `git:https://gitcode.com/owner/repo.git#main` |
| 本地调试 | `local:D:\path\to\plugin`(仅本机) |

安装即浅克隆到用户插件目录,`.gd-source` 记录来源,后续可一键更新。

## 3. 官网索引 meta.json 格式

每个收录的插件在官网后端有一个目录 `ai_web/backend/plugins/<id>/meta.json`:

```jsonc
{
  "schemaVersion": 1,
  "id": "qi-dusk-skin",                    // 必须与插件 manifest.id 一致
  "name": "柒·残月都市(皮肤)",
  "description": "原创 IP「柒」主题皮肤…",  // 中文名;英文用 descriptionEn(可选)
  "author": "GuaDa",
  "tags": ["theme", "skin"],               // 从标签表取词,见 /api/plugin-market/tags
  "icon": "https://…/icon.svg",            // 绝对 URL:插件仓库 raw 地址或官网静态资源
  "screenshots": ["/downloads/plugin-shots/qi-dusk-skin/1.webp"], // 相对路径自动补 BASE_URL
  "source": {
    "type": "github",                      // github | gitee | git
    "ref": "main",
    "install": "github:owner/repo#main"    // 客户端一键安装用
  },
  "repository": "https://github.com/owner/repo",
  "homepage": "https://…",                 // 可选
  "latest": {
    "version": "1.0.0",
    "apiVersion": 3,                       // 对应插件 manifest.apiVersion
    "channel": "stable",                   // stable | beta
    "changelog": "首发版本",
    "publishedAt": "2026-11-08T00:00:00Z"
  },
  "verified": false,                       // 官方审核通过才为 true
  "featured": false,                       // 官网推荐位
  "createdAt": "2026-11-08T00:00:00Z"
}
```

`downloads` 计数不写在 meta.json,由服务端维护在 `<id>/downloads.json`。

## 4. 提交收录流程

1. 插件仓库准备好(见 §1),确认 `github:owner/repo` 在干净机器上可一键安装成功;
2. 准备 1-4 张截图(建议 1600×1000 以内 webp/png,单张 ≤500KB)与 icon URL;
3. 向官网仓库提交收录请求:联系维护者,或直接提供 §3 的 meta.json 内容 + 截图文件;
4. 维护者通过管理 API(或直接放文件)收录,审核通过后设 `verified: true`;
5. 更新版本时:插件仓库打 tag 后,提供新的 `latest` 字段信息,维护者更新 meta.json。

## 5. 服务端 API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/plugin-market/list?page=&pageSize=&keyword=&tag=` | 分页列表 |
| GET | `/api/plugin-market/detail?id=` | 详情(含截图与 changelog) |
| GET | `/api/plugin-market/tags` | 标签聚合 |
| GET | `/api/plugin-market/index.json` | 全量快照 |
| POST | `/api/plugin-market/install` | 安装计数 +1(body: `{id}`),幂等宽松 |
| POST | `/api/admin/plugins-market` | 收录(X-Admin-Token) |
| PUT | `/api/admin/plugins-market/:id` | 更新收录 |
| DELETE | `/api/admin/plugins-market/:id` | 下架 |
| POST | `/api/admin/plugins-market/refresh` | 重建索引 |

## 6. 客户端消费

客户端(ai_chat)设置 → 插件 → 市场标签页,数据源默认
`https://ai.dingd.cn/api/plugin-market`,可用环境变量 `PLUGINS_MARKET_URL` 覆盖(联调用)。
安装走既有 `installPluginJob`,不引入新的分发协议。
