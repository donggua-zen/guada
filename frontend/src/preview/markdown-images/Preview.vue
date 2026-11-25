<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { WeatherMoon20Regular, WeatherSunny20Regular, Play20Regular, ArrowClockwise20Regular, Folder20Regular, Image20Regular } from '@vicons/fluent'
import PreviewMarkdown from './PreviewMarkdown.vue'
import { disposeFixtures, resolvePreviewImage, workspaceRoot, type Workspace } from './imageSource'

const initial = `## 这次生成的图表，直接放在回复里

图表已保存到工作目录。下方图片使用 **相对路径** 引用，点击可以查看完整尺寸。

### 小图按原始尺寸显示

这是一个 **96 × 96** 的 Logo，不会拉伸成整行大图。

![应用 Logo · 96 × 96](./outputs/logo.svg)

下面是 **160 × 40** 的状态标签，保持原始大小，图片外不套宽卡片。

![构建状态 · 160 × 40](./outputs/badge.svg)

### 连续多图，自动并排

这三张图片连续输出，按图片比例自动并排（不会把窄图拉宽），窄屏自动单列。

![项目增长图](./outputs/chart.svg)

![图片渲染流程](outputs/flow.svg)

![窄幅界面截图 · 180 × 420](./outputs/narrow.svg)

这里插入说明文字，后面的图片便会独立展示，不会跨过这段话合并。

![独立展示的增长图](./outputs/chart.svg)

### 长图也不会撑满聊天窗口

正文限制显示高度，图片容器随比例收窄，完整内容可以在大图预览中查看。

![独立展示的流程长图](outputs/flow.svg)

### 文件暂未生成时

下面这张图片先模拟加载失败。点击「重试」后，模拟文件已生成并恢复展示。

![稍后生成的图表](./outputs/pending.svg)

### 越出工作目录的引用

![工作目录外的图片](../private/secret.png)

图片以外的 Markdown 仍然正常显示：

\`\`\`ts
const image = './outputs/chart.svg'
// 图片相对当前消息所属会话的工作目录解析
\`\`\`
`
const content = ref(initial)
const visibleContent = ref(initial)
const workspace = ref<Workspace>('alpha')
const dark = ref(document.documentElement.classList.contains('dark'))
const mode = ref('demo')
const sessionInput = ref('')
const sessionId = ref('')
const workspacePath = ref('')
const connectionMessage = ref('')
const connecting = ref(false)
const showSource = ref(false)
const streaming = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
let connectGeneration = 0
const root = computed(() => sessionId.value ? workspacePath.value || '会话工作目录（由后端解析）' : workspaceRoot(workspace.value))
const imageSources = computed(() => [...content.value.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]))
const sourceRows = computed(() => imageSources.value.map(source => ({ source, ...resolveImage(source) })))
function resolveImage(source: string, retry = 0) {
  return resolvePreviewImage(source, {
    workspace: workspace.value,
    sessionId: mode.value === 'session' ? sessionId.value : '',
    workspacePath: workspacePath.value,
    retry,
  })
}
watch(dark, value => document.documentElement.classList.toggle('dark', value))
watch(content, value => { if (!streaming.value) visibleContent.value = value })
watch(mode, () => { connectGeneration++; connectionMessage.value = ''; connecting.value = false })
function stopStream() {
  clearInterval(timer)
  timer = undefined
  streaming.value = false
  visibleContent.value = content.value
}
function playStream() {
  if (streaming.value) { stopStream(); return }
  visibleContent.value = ''
  streaming.value = true
  let offset = 0
  timer = setInterval(() => {
    offset = Math.min(content.value.length, offset + 12)
    visibleContent.value = content.value.slice(0, offset)
    if (offset >= content.value.length) stopStream()
  }, 45)
}
function reset() {
  stopStream()
  content.value = initial
  workspace.value = 'alpha'
  mode.value = 'demo'
  sessionId.value = ''
}
async function connectSession() {
  const id = sessionInput.value.trim()
  if (!id) { connectionMessage.value = '请填写要预览的会话 ID'; return }
  const generation = ++connectGeneration
  connecting.value = true
  connectionMessage.value = ''
  try {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token') || ''
    const response = await fetch(`/api/v1/sessions/${encodeURIComponent(id)}/workspace-path`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) throw new Error(`接口返回 ${response.status}，请确认会话 ID 和当前登录状态`)
    const result = await response.json()
    if (!result.workspacePath) throw new Error('接口未返回工作目录')
    if (generation !== connectGeneration) return
    workspacePath.value = result.workspacePath
    sessionId.value = id
    connectionMessage.value = '已接入真实会话。将下方 Markdown 改为该工作目录中实际存在的图片路径。'
  } catch (error) {
    if (generation === connectGeneration) connectionMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (generation === connectGeneration) connecting.value = false
  }
}
onBeforeUnmount(() => { stopStream(); disposeFixtures(); connectGeneration++ })
</script>

<template>
  <div class="preview-app">
    <header class="preview-header">
      <a class="preview-brand" href="/markdown-images-preview.html"><Image20Regular /><span>Markdown 图片</span><span class="preview-tag">临时预览</span></a>
      <div class="header-actions">
        <button type="button" @click="reset"><ArrowClockwise20Regular />重置</button>
        <button type="button" :aria-label="dark ? '切换浅色模式' : '切换深色模式'" @click="dark = !dark"><WeatherSunny20Regular v-if="dark" /><WeatherMoon20Regular v-else /></button>
      </div>
    </header>
    <div class="preview-layout">
      <aside class="preview-controls">
        <div class="eyebrow">图片的起点，是工作目录</div>
        <h1>让图片自然地<br />出现在对话里。</h1>
        <p class="intro">相对路径自动定位，长图收起展示，点开看完整图片。</p>
        <div class="mode-switch" aria-label="数据来源">
          <button type="button" :class="{ selected: mode === 'demo' }" @click="mode = 'demo'">离线演示</button>
          <button type="button" :class="{ selected: mode === 'session' }" @click="mode = 'session'">真实会话</button>
        </div>
        <template v-if="mode === 'demo'">
          <label class="field-label" for="workspace">工作目录</label>
          <select id="workspace" v-model="workspace"><option value="alpha">工作目录 A · 增长报告</option><option value="beta">工作目录 B · 增长报告</option></select>
          <p class="helper">切换后，同一个 <code>./outputs/chart.svg</code> 会显示另一个目录中的图表。</p>
        </template>
        <template v-else>
          <label class="field-label" for="session-id">会话 ID</label>
          <div class="session-field"><input id="session-id" v-model="sessionInput" placeholder="输入本项目的会话 ID" @keydown.enter="connectSession" /><button type="button" :disabled="connecting" @click="connectSession">{{ connecting ? '连接中' : '连接' }}</button></div>
          <p class="helper">使用当前浏览器登录凭据访问本地后端；不修改会话内容。</p>
          <p v-if="connectionMessage" class="connection-message" role="status">{{ connectionMessage }}</p>
        </template>
        <div class="workspace-root"><Folder20Regular /><span>{{ root }}</span></div>
        <div class="section-heading"><label for="markdown-editor">试试自己的 Markdown</label><button type="button" class="text-button" @click="showSource = !showSource">{{ showSource ? '收起编辑器' : '展开编辑器' }}</button></div>
        <textarea v-if="showSource" id="markdown-editor" v-model="content" spellcheck="false" aria-label="Markdown 内容"></textarea>
        <button class="stream-button" type="button" @click="playStream"><Play20Regular />{{ streaming ? '完成输出' : '模拟流式输出' }}</button>
        <details class="path-details">
          <summary>查看图片路径解析</summary>
          <div v-for="(row, index) in sourceRows" :key="index" class="path-row"><code>{{ row.source }}</code><span>↓ {{ row.kind }}</span><code>{{ row.target }}</code></div>
        </details>
        <p class="preview-note">{{ mode === 'demo' ? '演示图片为本页生成的样例，不读取你的磁盘。' : sessionId ? '真实会话图片经现有工作区文件接口读取。' : '连接会话前暂时显示离线样例。' }}<br />仅供评估效果，尚未接入正式聊天组件。</p>
      </aside>
      <main class="chat-preview">
        <div class="chat-topline"><span class="status-dot"></span>{{ mode === 'session' && sessionId ? '真实工作区图片' : '交互效果预览' }}<span class="chat-topline-right">{{ streaming ? '正在输出…' : 'Markdown · 图片增强' }}</span></div>
        <div class="chat-column">
          <div class="user-bubble">帮我把生成的图表放在回复里，我想直接看效果。</div>
          <article class="assistant-turn">
            <div class="assistant-heading"><span class="assistant-avatar">G</span><strong>GuaDa</strong><span>{{ streaming ? '正在生成' : '已完成' }}</span></div>
            <PreviewMarkdown :content="visibleContent" :workspace="workspace" :session-id="mode === 'session' ? sessionId : ''"
              :workspace-path="workspacePath" />
          </article>
          <div class="preview-footer">支持懒加载 · 异步解码 · 大图预览 · 失败重试 · 与正式聊天组件同一实现</div>
        </div>
      </main>
    </div>
  </div>
</template>

<style>
html, body, #app { margin: 0; min-height: 100%; }
body { font-family: var(--gd-font-sans); color: var(--gd-color-text); background: var(--gd-color-bg); font-size: 14px; line-height: 22px; }
* { box-sizing: border-box; }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .6; cursor: wait; }
button, select, input, textarea { color: var(--gd-color-text); }
.preview-header { height: 68px; display: flex; justify-content: space-between; align-items: center; padding: 0 32px; border-bottom: 1px solid var(--gd-color-border); }
.preview-brand { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; font-weight: 600; }
.preview-brand > svg { color: var(--gd-color-primary); }
.preview-tag { font-weight: 400; font-size: 11px; line-height: 20px; padding: 1px 8px; border-radius: 6px; background: color-mix(in srgb, var(--gd-color-primary) 10%, transparent); color: var(--gd-color-primary); }
.header-actions { display: flex; gap: 8px; }
.header-actions button { display: flex; gap: 6px; align-items: center; border: 1px solid var(--gd-color-border); background: transparent; padding: 6px 10px; border-radius: 8px; font-size: 12px; line-height: 20px; }
.preview-app svg { width: 20px; height: 20px; flex-shrink: 0; }
.preview-layout { display: grid; grid-template-columns: 360px minmax(0, 1fr); max-width: 1540px; margin: auto; }
.preview-controls { padding: 36px 28px; border-right: 1px solid var(--gd-color-border); }
.eyebrow { font-size: 12px; color: var(--gd-color-primary); margin-bottom: 12px; }
.preview-controls h1 { font-size: 28px; line-height: 38px; letter-spacing: -.6px; margin: 0 0 14px; font-weight: 600; }
.intro { color: var(--gd-color-text-gray); margin: 0 0 28px; line-height: 24px; }
.mode-switch { display: flex; padding: 4px; gap: 4px; border: 1px solid var(--gd-color-border); border-radius: 10px; margin-bottom: 22px; }
.mode-switch button { flex: 1; padding: 6px; border: 0; background: transparent; border-radius: 6px; font-size: 13px; }
.mode-switch button.selected { background: color-mix(in srgb, var(--gd-color-primary) 10%, var(--gd-color-bg)); color: var(--gd-color-primary); }
.field-label { display: block; font-size: 12px; margin-bottom: 8px; font-weight: 600; }
.preview-controls select, .preview-controls input, .preview-controls textarea { width: 100%; border: 1px solid var(--gd-color-border); border-radius: 8px; background: var(--gd-color-bg); padding: 9px 10px; font-size: 12px; line-height: 20px; }
.preview-controls select:focus, .preview-controls input:focus, .preview-controls textarea:focus { outline: 2px solid color-mix(in srgb, var(--gd-color-primary) 35%, transparent); }
.helper, .connection-message { font-size: 12px; line-height: 20px; color: var(--gd-color-text-gray); margin: 10px 0; }
.connection-message { color: var(--gd-color-primary); overflow-wrap: anywhere; }
.workspace-root { display: flex; align-items: flex-start; gap: 8px; padding: 12px; background: color-mix(in srgb, var(--gd-color-text) 3%, var(--gd-color-bg)); border-radius: 8px; margin: 16px 0 26px; color: var(--gd-color-text-gray); font-size: 11px; line-height: 20px; overflow-wrap: anywhere; }
.workspace-root svg { width: 16px; height: 20px; }
.session-field { display: flex; gap: 6px; }
.session-field input { min-width: 0; }
.session-field button { flex-shrink: 0; border: 1px solid var(--gd-color-border); border-radius: 8px; background: transparent; padding: 6px 10px; font-size: 12px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; font-size: 12px; margin-bottom: 12px; }
.text-button { background: none; border: 0; color: var(--gd-color-primary); font-size: 12px; padding: 0; }
.preview-controls textarea { min-height: 260px; resize: vertical; font-family: monospace; margin-bottom: 12px; }
.stream-button { display: flex; gap: 8px; align-items: center; justify-content: center; width: 100%; border: 1px solid var(--gd-color-border); background: transparent; padding: 10px; border-radius: 8px; }
.stream-button:hover, .header-actions button:hover { background: color-mix(in srgb, var(--gd-color-text) 4%, transparent); }
.path-details { margin-top: 24px; font-size: 12px; }
.path-details summary { cursor: pointer; color: var(--gd-color-text-gray); }
.path-row { display: grid; gap: 6px; margin-top: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--gd-color-border); font-size: 11px; line-height: 18px; overflow-wrap: anywhere; }
.path-row span { color: var(--gd-color-primary); }
.path-row code { white-space: pre-wrap; }
.preview-note { margin-top: 24px; font-size: 11px; line-height: 20px; color: var(--gd-color-text-gray); }
.chat-topline { display: flex; align-items: center; gap: 8px; padding: 20px 32px; font-size: 12px; line-height: 20px; color: var(--gd-color-text-gray); border-bottom: 1px solid var(--gd-color-border); }
.chat-topline-right { margin-left: auto; font-size: 11px; }
.status-dot { width: 6px; height: 6px; background: #5ca58d; border-radius: 50%; }
.chat-column { max-width: 792px; padding: 36px 28px 48px; margin: auto; }
.user-bubble { width: fit-content; max-width: 86%; margin: 0 0 36px auto; padding: 10px 16px; border-radius: 16px 16px 4px 16px; background: var(--gd-color-bubble-user-bg); border: 1px solid var(--gd-color-bubble-user-border); color: var(--gd-color-bubble-user-text); }
.assistant-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
.assistant-avatar { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: color-mix(in srgb, var(--gd-color-primary) 12%, transparent); color: var(--gd-color-primary); font-size: 15px; font-weight: 600; }
.assistant-heading strong { font-size: 14px; }
.assistant-heading > span:last-child { color: var(--gd-color-text-gray); font-size: 11px; }
.preview-footer { margin-top: 30px; border-top: 1px solid var(--gd-color-border); padding-top: 20px; color: var(--gd-color-text-gray); font-size: 11px; }
@media (max-width: 950px) { .preview-layout { grid-template-columns: 300px minmax(0, 1fr); } .preview-controls { padding: 28px 20px; } .chat-column { padding: 28px 20px; } .chat-topline { padding: 18px 20px; } .chat-topline-right { display: none; } }
@media (max-width: 700px) { .preview-header { padding: 0 16px; height: 60px; } .preview-layout { grid-template-columns: 1fr; } .preview-controls { border-right: 0; border-bottom: 1px solid var(--gd-color-border); padding: 24px 20px; } .preview-controls h1 { font-size: 24px; line-height: 32px; } .preview-controls h1 br { display: none; } .preview-controls .intro { margin-bottom: 20px; } .preview-tag { display: none; } }
</style>
