# 聊天附件引用形态与落点（2026-09 统一）

> 状态：已实现
> 范围：对话框附件（上传 → 落盘 → 持久化 → 模型请求 → 前端展示）
> 相关：`docs/message-pipeline-normalization-plan.md`（L0/L1/L2 分层与本方案的 file 块投影）

---

## 1. 目标

把聊天附件统一成**一种东西**：一个带路径的引用。区别只剩「路径指向哪里」。

| 形态 | 谁产生 | 落点 | 给模型的路径 |
|---|---|---|---|
| 图片 | Web 与 Electron 都上传 | **会话数据目录** `<sessionsBase>/<id>/images`（+ `previews` 缩略图） | 内联字节（base64 / inlineData），不给路径 |
| 普通文件（Web） | Web 上传 | **会话工作目录** `<workspacePath>/<subdir>/` | 工作目录相对引用 → 请求时桥接为绝对路径 |
| 普通文件（Electron） | 不上传 | 不动（用户本地原位） | 本机绝对路径 |

要点：

1. **不再预解析**。PDF/docx/xlsx 上传时不再抽取文本、也不再读文件内容——模型拿到路径，
   需要内容时自己按扩展名选工具（`document.doc_parse` / `read`）。
2. **普通文件落到工作目录**，因为工作目录是模型工具（`read`/`glob`/`grep`/`doc_parse`）
   的解析基准。放在全局目录里，相对路径对它没有意义。
3. **Electron 不再把路径拼进消息正文**。旧实现把「本机路径」写进 `content` 文本，
   附件混进用户的话里；现在它是和其他附件一样的块。
4. **图片随会话数据目录走**：删除会话 / 清空会话 / 子会话级联删除都是对会话目录的
   整目录 `rm -rf`，图片随之自动消失，不产生孤儿文件、不占全局上传目录、也不碰用户
   工作目录——与 `workflows/` 同一个「删除免费」模式。代价是 `/uploads` 静态挂载不再
   覆盖它们（那个挂载点也绝不能覆盖 sessions 根，里面是 JSONL 对话记录），展示走
   新增的带鉴权取图端点。

---

## 2. 契约：`FileRef.refType`

`common/types/conversation.types.ts`：

```ts
refType?: 'store' | 'workspace' | 'session' | 'local';   // 缺省 = 'store'
```

- `store`：`UPLOAD_ROOT_DIR` 下的存储引用（头像、壁纸、**旧版**聊天图片），形如 `uploads/images/20260915/x.jpg`
- `workspace`：会话工作目录内的相对引用，形如 `uploads/20260915/报告_1430_ab12cd.pdf`
- `session`：会话数据目录内的引用（**图片**），形如 `sessions/<id>/images/20260915/报告_1430_ab12cd.jpg`
  —— url **自包含**（内嵌 sessionId），解析端可直接反推会话目录，无需任何上下文
- `local`：宿主本机绝对路径，形如 `D:\docs\报告.pdf`

**缺省值就是向后兼容策略**：历史 JSONL 没有这个字段，一律按 `store` 解释——
与旧行为逐字节一致，不需要任何数据迁移。旧文件继续留在全局目录里可读。

---

## 3. 落盘（FileService）

```
uploadFile(sessionId, file)
  ├─ 位图扩展名（RASTER_IMAGE_EXTENSIONS）→ uploadImageFile
  │     → <sessionsBase>/<id>/images|previews/YYYYMMDD/，refType='session'，url 自包含
  └─ 其余                                  → uploadWorkspaceFile → <workspace>/<subdir>/YYYYMMDD/，refType='workspace'
```

- 位图判定用 `isRasterImageExtension`（`png jpg jpeg gif bmp webp tif tiff avif heic heif`）。
  `svg / ico / psd / ai / eps` **不是位图**：sharp 转不了码、视觉模型也不接受，
  它们走普通文件分支当路径引用。
- 图片经 sharp 统一转 JPEG，因此 `name` / `fileExtension` / `mediaType` 一起改成
  `jpg` / `image/jpeg` —— 让声明与字节一致（旧实现是 `.png` 名 + JPEG 字节 + `image/png` 声明）。
- 非图片一律 `fs.writeFile(buffer)`，字节原样落盘，不解析、不解码。
- `name` 是**完整文件名**（含扩展名）。旧实现给的是剥掉扩展名的 `displayName`，
  导致模型看到「季度报告」而不知道格式。

### 3.1 图片落会话数据目录（随会话删除免费）

图片字节放在 `<sessionsBase>/<sessionId>/images|previews/`，url 为 `sessions/<id>/...`：

- **生命周期 = 会话生命周期**：删除会话 / 清空会话 / 子会话级联删除全部是对会话目录的
  整目录 `rm -rf`（`JsonlBackend.deleteSession` / `SessionFileStore.deleteSession` 等，
  已逐一核实），图片自动随之消失，**零删除钩子**，未来新增删除路径也不会漏。
  清空会话（`DELETE /sessions/:id/messages`）同样连带删除——消息引用已随清空消失，
  留图即成孤儿，这是正确行为。
- **url 自包含**：内嵌 sessionId，任何渲染/内联点不需要会话上下文：
  - 后端内联字节：`attachmentToPart` 按 `refType='session'` 反推会话目录读盘
  - 前端展示：`toResourceUrl` 识别 `sessions/<id>/...` 前缀 → 拼鉴权取图端点
    `GET /api/v1/sessions/<id>/attachments/raw-file?path=..&token=..`（`<img>` 带不上
    Authorization 头，token 走 query，workspace raw-file 同款）
- **不迁移**：历史 `uploads/images/...`（refType 缺省='store'）继续可读可显；
  全局 `images/`/`previews/` 目录只是不再增长。
- 为什么不做成 `<UPLOAD_ROOT_DIR>/sessions/<id>/`：那样删除必须补钩子、且与
  「会话数据归会话目录」的既有布局（JSONL / meta / workflows）割裂。取图端点是
  唯一的新安全面，由 `resolveSessionAttachmentPath`（id 合法性 + 会话目录前缀校验）
  封死，纯函数单测覆盖穿越用例。

### 3.1 没有类型白名单

普通文件既是路径引用，限制可附格式就没有意义，所以限制整体取消：

- 前端文件选择器**不设 `accept`**、不按扩展名筛（图片选择器的 `accept` 只是给系统
  文件对话框加个过滤器，不是准入策略）
- 后端 multer **不做类型过滤**，`validateFile` 也不校验扩展名
- 没有扩展名的文件（`Makefile`、`LICENSE`）同样可附：`fileExtension` 省略，
  MIME 退到 `application/octet-stream`，工具指引退到 `read`
- 文件名的扩展名分类收敛到**一张表**（`utils/media-type.ts` 的
  `RASTER_IMAGE_EXTENSIONS`，与后端镜像契约测试同源）。原先前端另有一份几百项的
  白名单，正是前后端分叉（前端当图片选、后端当文件存）的来源

顺带取消的还有「图片与文件不能混发」：后端按 `mediaType` 逐块落 `image`/`file` 块，
两种块本来就能共存于同一条消息、各自投影。原先那条限制是纯前端人为约束，
在附件不再受格式限制之后尤其没有理由留着。

唯一保留的区分是**按真实类型分流**（`classifyAttachment`）：位图走图片通道，
其余走路径通道。这与「从哪个按钮选」无关——同一个 `.png` 无论从哪个入口进来
都是图片，否则会出现「同一文件因按钮不同而落点不同」的怪异行为。

子目录名来自设置 `system.chatUploadSubdir`（默认 `uploads`，设置中心可改）。
它会被拼进工作目录路径，所以只接受单层目录名：

- 运行时：非法值静默回退默认值（`normalizeChatUploadSubdir`），不让一个坏配置把上传打死
- 设置写入时：`BadRequestException` 明确拒绝（用户需要立刻知道这个值不被接受）

---

## 4. 投影：file 块的路径桥接

`fileBlockToText`（`llm-core/utils/attachment.util.ts`）是 file 块文案的唯一出口，
但它在 adapter 里被调用，**拿不到会话上下文**——所以 `workspace` 引用在 adapter 里
无法桥接。解决方式是在 L1 管线加一个步骤：

```
存储层:  { type:'file', attachment:{ url:'uploads/20260915/报告.pdf', refType:'workspace' } }
   ↓ file-path-bridge（L1，有 ctx.workspaceDir，纯函数、只改副本）
请求视图: { type:'file', attachment:{ url:'D:\\...\\uploads\\20260915\\报告.pdf', refType:'local' } }
   ↓ adapter → fileBlockToText
模型看到: [文件: 报告.pdf (D:\...\报告.pdf)]。解析内容请调用 document.doc_parse（file_path 传上面的绝对路径）
```

为什么不直接让管线追加一个路径文本块（像 `image-path-annotation` 那样）：
那会把路径文案写两遍（管线一遍、4 个 adapter 各一遍）。改写引用让
「引用 → 文案」只在一处实现。

配套约束：

- `transformKey()` 必须包含 `workspaceDir`，否则改了工作目录而沿用旧快照，
  模型会拿到已经失效的绝对路径。
- 桥接失败（无 `workspaceDir` / 引用越出工作目录）时不改写，下游退化为只给文件名——
  **不编造路径**（工具按工作目录解析必然报错，给了错路径比不给更糟）。
- 绕过管线的调用方（压缩摘要、标题生成、记忆同步）拿到的是「只有文件名」的降级结果，
  不会写出错误路径。

---

## 5. 工具指引

`fileBlockToText` 按扩展名分派：

| 扩展名 | 指引 |
|---|---|
| `pdf doc docx xls xlsx ppt pptx` | `document.doc_parse`（`read` 只会读到二进制乱码） |
| 其余 | `read` |

这是对图片侧既有做法的对称补齐：图片有 `image_recognize` 的明确指引，
而文件侧原先只有一行 `[文件: name (path)]`，模型不知道该调什么工具。

---

## 6. 前端

- `ChatInput` 的附件列表是**本组件的 ref**（`localFiles`），不是 computed 的缓存值。
  旧实现把列表存在 `uploadFiles` computed 的 getter 返回值上（`.map()` 的副本里 push），
  附件的存活取决于 computed 有没有被重新求值——任何一次依赖变化都可能让已选附件消失。
- 上传时机：点发送 → 串行上传待上传项（真实进度写回卡片）→ 全部成功才 `emit('send')`。
  失败则**保留列表与正文**、卡片标红，用户再按一次发送即可重试。
  未发送的文件不会落进工作目录（那是模型的工作区，`glob` 会看到里面的一切）。
- create 模式没有 sessionId，`uploader` 缺省 → 由父组件在会话创建后上传（同一套转换逻辑）。
- 分派点唯一：`toPayloadFileRef`（`useMessageOperations.ts`）
  - 有 `url` → 透传（含 `refType`）
  - 有 `localPath` → `refType='local'`
  - 只有 `File` → `null`，调用方先上传

---

## 7. 展示与静态服务

- 前端图片判定用 `isVisionImageMediaType`（位图白名单），不是 `startsWith('image/')`：
  `image/svg+xml`、`image/x-icon` 不该被当图片渲染或送进大图预览。
  两侧都只保留这一个判定（原 `isImageMediaType` 已删除——留两个相似入口会让人选错，
  这正是本次要消除的那类隐患）。
- 同一条消息可以同时有图片和普通文件，所以大图预览要按「附件在图片子集里的位置」
  取索引，不能用外层列表下标（否则取错图甚至越界）。
- 图片展示分两条通道：
  - **新版会话图片**（refType='session'）→ 鉴权取图端点 `GET /api/v1/sessions/:id/attachments/raw-file?path=..&token=..`，
    头策略复用下面的位图规则（inline + 真实图片 MIME）
  - **存量 `/uploads` 静态服务**（旧 store 图片、头像、壁纸）按扩展名分两类：
    - 位图 → `inline` + 真实图片 MIME（`<img src>` 需要）
    - 其余 → `attachment` + `application/octet-stream` + `nosniff`

  原因：附件目录与前端同源且用户可写，放开 `.html`/`.svg` 的 inline 等于给了
  存储型 XSS——上传的脚本能在应用同源下执行，读走 localStorage 里的 token。
  位图分支**不设** `nosniff`：历史文件存在「扩展名 `.png`、字节是 JPEG」的情况，
  加了会让这批存量图片显示不出来；而白名单里全是不可执行脚本的位图类型，嗅探无风险。

---

## 8. 限额只约束真正过网络的文件

单文件上限（默认 100MB，`CHAT_UPLOAD_MAX_MB` 可配）的适用范围是
**字节需要经 HTTP 上传的文件**，判据是 `planAttachment().needsUpload`：

| 场景 | 是否上传 | 受限额约束 |
|---|---|---|
| Web 普通文件 | 是（落工作目录） | ✅ |
| Web 图片 | 是（落会话数据目录） | ✅ |
| Electron 图片 | 是（需转码 + 内联给模型） | ✅ |
| Electron 普通文件 | 否（只发本机绝对路径） | ❌ |
| Electron 粘贴的 Blob 文件 | 是（拿不到本机路径） | ✅ |

Electron 下非图片附件只把本机绝对路径作为引用发出去，字节始终留在本机，
本服务既不接收也不存储——给它套上传限额没有意义，2GB 的本地压缩包照样可以附上。

仍然会拦的只有 0 字节条目：拖入文件夹时 `dataTransfer.files` 里就是这种
（无内容、无扩展名），拦掉并明确提示，而不是静默丢弃。

## 9. 不做的部分

- **不迁移历史文件**。老附件留在全局目录里，`store` 语义继续可读。
- **不做孤儿回收**。上传成功但未发送的文件（失败重试路径、会话中途关闭）不会自动清理；
  工作目录随会话删除时才整体消失（且仅限默认工作目录）。
- **不做上传队列/取消**。串行上传 + 进度 + 失败重试已覆盖主要诉求，
  并发队列/中断的需求等有实际场景再谈。
