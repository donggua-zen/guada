# 系统注入归一化方案（v3：kb-ref 独立块）

> 状态：**已实现并通过验证（2026-09-03）**。后端 tsc --noEmit 零错误；前端 vue-tsc 触碰文件零新增错误；
> 全量回归全绿（test/chat + test/agent-engine + test/llm-core + test/common = 22 套 198 用例）。
> 注：两套 workspace-watcher spec 为重构遗留的**既有失败**（service spec 过期构造函数 / integration 缺
> setWatchScope 激活），当日已一并修复（另修 scope 快速重入双订阅竞态），详见记忆。
> v3 按用户意见修订：kb-ref **新建独立引用块**，system 维持 text+标记。
> v2 的 origin='kb-ref'（text 块 + 标记）改为独立块类型——KB 引用是结构化数据（id/name/description），
> 独立判别成员语义更清晰、前端渲染分支干净、未来可扩展（如每库附件），符合项目"块即类型"惯例。

## 一、最终类型设计

```ts
// 后端 conversation.types.ts + 前端 content-block.types.ts（同步扩展）

/** system 块维持 text+标记（内容本质是任意文案，最小改动） */
export interface TextBlock {
  type: 'text';
  text: string;
  timing?: BlockTiming;
  /** 块级注入标记：缺省=正常内容；'system'=系统注入（前端不渲染不重建） */
  origin?: 'system';
}

/** KB 引用块（独立判别成员）：LLM 按 kbRefsToText 投影渲染，前端按 chips 渲染 */
export interface KbRefBlock {
  type: 'kb-ref';
  kbRefs: Array<{ id: string; name: string; description?: string }>;
  timing?: BlockTiming;
}

export type ContentBlock = ... | KbRefBlock;
```

**两种机制并存的语义边界**：
- `text + origin='system'` → 对前端**完全不可见**的系统文案（sandbox 切换等）
- `kb-ref 块` → 结构化引用，前端有**专门渲染形态**（chips）

## 二、LLM 渲染路径：L1 管线投影（对齐 image-projection 先例）

`message-transform.pipeline.ts` 新增步骤（与 `imageProjectionStep:60` 同构——存储原样保留特殊块，
读取视图投影为文本）：

```ts
export const kbRefProjectionStep: TransformStep = {
  name: 'kb-ref-projection',
  apply(messages) {
    // 所有模型统一投影（当前无协议原生支持 kb-ref 块；无能力参数）
    return messages.map((msg) => {
      if (!msg.content.some((b) => b.type === 'kb-ref')) return msg;
      return {
        ...msg,
        content: msg.content.map((b): ContentBlock =>
          b.type !== 'kb-ref' ? b : { type: 'text', text: kbRefsToText(b.kbRefs) },
        ),
      };
    });
  },
};
```

- **adapter 零改动**（管线在请求组装前统一投影，协议词汇不进 L1 的边界保持）
- 投影在**请求视图**发生，落库/快照 view 原样保留 KbRefBlock（前端拿到的还是结构化块）

`kbRefsToText` 共享 util（`common/utils/`，token-meter / summary / pipeline 三处复用）：

```ts
export function kbRefsToText(refs): string {
  const lines = refs.map(r =>
    `- name: ${r.name}, id: ${r.id}${r.description ? `, description: ${r.description}` : ''}`);
  return `[referenced knowledge bases]\n${lines.join('\n')}`;
}
```

## 三、写入与消费点（tsc 穷尽检查自动暴露）

| 点 | 改动 |
|---|---|
| `jsonl-session-context.addUserMessage` | 有 knowledgeBaseIds → content 尾部追加 `KbRefBlock`（KB 明细经 KnowledgeBaseService 展开）；sandbox 切换 → content 尾部追加 `{type:'text', text:'<system_reminder>...', origin:'system'}` |
| `token-meter.countBlock`（:106 switch） | `case 'kb-ref': countTextTokens(kbRefsToText(block.kbRefs))` |
| `llm-summary serializeMessages`（:263 switch） | `case 'kb-ref': parts.push(kbRefsToText(...))`（引用清单进摘要文本，语义正确） |
| `jsonl-message.service:464` | 删除 `metadata.referencedKbs` id 数组包装（单一事实源 = 块） |
| `KnowledgeBaseModule` | exports `KnowledgeBaseService` + 补 `findByIds`；`chat.module.ts` imports |
| `detectModeTransition`（:465/:851） | 产物改 system 块；filter 排除 `kind==='model'`（修 hidden 消息污染 prevMode 的既有坑）；删除 `metadata.systemReminder` 写入 |

## 四、前端改动点

| 点 | 改动 |
|---|---|
| `content-block.types.ts` | 加 `KbRefBlock` + TextBlock.`origin?` |
| `streamProjector.applyCompleteBlock`（:184 if 链） | 加 `kb-ref` 分支：kbRefs 透传到 TurnContent（如 `content.metadata.kbRefs`）；text 块透传 `origin`（system 块标记给渲染层） |
| `toUserMessageView`（messageUtils:24-27） | user 正文拼接跳过 `origin='system'` 块与 kb-ref 块（kb-ref 无 content 字段现被 filter 天然排除，显式化更稳） |
| `TurnItem.vue:41-51` | KB chips 数据源：块 kbRefs（优先）→ `metadata.referencedKbs`（旧数据回退） |

## 五、语义与缓存

- **KV 缓存**：注入块/引用块加在 novel 消息尾部 → 前缀逐字节不变 → 零损失；此后成稳定历史前缀
- **压缩**：随消息遮蔽；摘要序列化含引用清单文本（投影前手动处理）——与旧版行为一致
- **旧数据兼容**：前端 chips 优先块、回退 metadata；无旧 kb-ref 块数据
