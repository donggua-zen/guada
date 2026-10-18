# 单账户模型（account.json）

## 定位：这不是安全边界

应用数据（会话、角色、知识库、机器人）在磁盘上明文存储，**账户密码不构成安全边界**。
它的唯一用途是：**公网部署时挡住路人**，不让任何能访问到地址的人直接进入。

因此本模型刻意不做这些事：

| 不做 | 原因 |
|---|---|
| 密码复杂度策略 | 数据都裸奔了，给账户装好锁没有意义 |
| 登录失败限流 / 锁定 | 同上；暴力破解者拿到的也只是明文本来就在磁盘上的数据 |
| Token 吊销 / 会话管理 | 无多用户，token 只证明"你知道密码" |
| 密码找回流程 | 见下「遗忘密码」 |
| 二次验证 / 硬件密钥 | 超出"挡路人"的定位 |

## 账户存储

**`<SETTINGS_DIR>/account.json`**（与 `models.json` 同目录；Electron 下即 `~/.guada/account.json`）：

```json
{
  "username": "guada",
  "passwordHash": null,
  "nickname": "管理员",
  "avatarUrl": "uploads/avatars/xxx.jpg",
  "wallpaperUrl": null,
  "createdAt": "2026-09-12T06:52:45.516Z",
  "updatedAt": "2026-09-12T06:52:45.516Z"
}
```

- `passwordHash` 为 `null` / 缺失 → **未设密码**（免登录）
- `passwordHash` 有值 → 必须登录（bcrypt，与历史账户同格式）
- 无 `id` 字段：单账户不需要主键；JWT payload 只用 `username`
- 头像/壁纸仍走既有 `uploads/` 上传管线，只把引用路径写回本文件

内存缓存 + 原子写（tmp + rename + Windows EPERM 退避重试）。

## 密码即免登录开关

**密码存在与否，就是免登录开关**——不再有独立的 `autoLoginEnabled` 设置。
（两者语义重叠：留着会出现"设了密码却仍免登录"的坑，等于密码形同虚设。）

**UI 入口**：设置中心 → 安全设置 → 「访问密码」开关（开启即设置密码，关闭即清除密码）；已设密码时同页显示修改密码表单，免密状态下不显示。

| 端点 | 可见性 | 行为 |
|---|---|---|
| `GET /auth/status` | 公开 | `{ passwordSet }` —— 前端据此决定是否强制登录 |
| `POST /auth/login` | 公开 | 校验 username + password（均大小写不敏感）；**未设密码时用户名匹配即放行**（免密实例不该有"任何密码都失败"的死路） |
| `POST /auth/auto-login` | 公开 | **仅在未设密码时**签发凭据；已设密码返回 400 |
| `PUT /user/password` | 需鉴权 | 设置/修改密码（已设密码时需旧密码） |
| `POST /user/password/change` | 需鉴权 | 同上（前端用） |
| `DELETE /user/password` | 需鉴权 | 清除密码 → 回到免登录 |

**前端入口约定**：路由守卫统一走 `authStore.ensureEntry()`——已有 token 则服务端校验；否则查 `/auth/status`，未设密码（或状态未知）时由 `/auth/auto-login` 裁决（服务端权威，不会绕过密码）。`/login` 另设**反向守卫**：免密则自动进入并重定向，确保免密实例既不显示、也无法停留在登录页（兜住 401 全局跳转与"退出登录"落入 `/login` 的情况）。`/auth/status` 查询失败**不得**被当作"已设密码"。

**鉴权守卫**（`AuthGuard`）：有 token → 校验并放行；无 token → 未设密码则放行，否则 401。
三条 token 通道（HTTP Guard / WebSocket / html-preview 手写 JWT）统一从账户文件解析，不再查库。

> ⚠️ 实现注意：`AuthGuard` **必须** 先 `await accountStore.ensureReady()`。
> 预热前读到空账户会把"已设密码"误判为免登录而放行——这是安全语义问题，不是性能问题。

## 保留的边界

单账户移除的是**归属校验**（"这条数据是不是你的"），**不是鉴权**：

- 保留：`AuthGuard` 对全部业务路由的访问控制（未设密码时免登录，设了密码则必须带有效 token）
- 移除：`session.userId !== userId` 这类比较（单账户下恒真，是死逻辑）
- `@Public()` 白名单保持不变，仅新增 `/auth/status`

## 遗忘密码怎么办

编辑 `account.json`，删掉 `passwordHash` 那一行（或置为 `null`），重启即可重新无密码进入。
这是刻意保留的逃生通道——既然不做安全边界，就不该有把用户锁在门外自己的数据之外的设计。

> 历史包袱说明：早期版本用 `password_is_set.txt`（安装目录下的标记文件）记录"是否已设密码"，
> 该文件在升级时会被覆盖丢失、Electron 下还可能只读，已删除——状态改由账户文件本身承担。

## 从多账户升级

进程启动时 `AccountBootstrapService` 执行一次性引导：

1. `account.json` 已存在 → 跳过（幂等）
2. 不存在且 DB `user` 表有行（老用户升级）→ **导入该行**，
   `passwordHash` 原样搬运（多行时优先 `role='primary'`，其余忽略并告警）
3. 都不存在（全新安装）→ 写默认账户：`{ username: 'guada', nickname: '管理员', passwordHash: null }`

**第 2 步是硬要求**：若只做"文件缺失就写默认值"，老用户升级后密码会丢失、
实例直接变成敞开状态，恰好违背引入账户的目的。

### DB 中的 user 表

`user` / `user_setting` 表**保持原样冻结**，作为回滚快照保留（上线前删除）。
迁移 `0005_drop_user_dimension` 只移除真正阻塞写入的 `userId` 列：
`mcp_server.user_id`（NOT NULL + FK）与 `file.upload_user_id`（只写不读）。

## 数据不再按用户隔离

`userId` 作为数据归属维度已**彻底移除**：

- 文件格式（`sessions/<id>/meta.json`、`_groups.json`、`agents/<id>/AGENT.md`、
  `bots/<id>.yaml`、`kb.json`、`scheduler/tasks.json`）不再写 userId；
  旧文件里的残留字段读取时忽略（向后兼容，无需数据迁移）
- 仓储签名（`findByUserId` → `findAll`、`listWebSessionIds()` 等）与 SSE 订阅分区同步去维度
- 冻结表（session/character/kb/bot/…）保留 userId 列，仅作回滚快照

## 后续多用户如何衍生

本基础版是单账户的**收敛实现**，多用户应在它之上衍生而非把 userId 重新耦合回来：

- 账户层：`account.json` → `accounts/<id>/account.json`，或引入 `users.json` 索引。
  认证入口已收敛为「解析到唯一账户」单点（`AccountFileStore`），扩展点集中。
- 归属层：`userId` 需要重新引入时，建议**只在业务实体上加字段**，
  并把这层做成独立中间件/守卫，而不是散落在每个仓储方法签名里（这正是本次移除的形态）。
- 会话/角色/KB/机器人已是文件存储，加 `ownerId` 字段即可按用户分区，无需动存储层。
