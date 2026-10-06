<template>
  <div class="cel-editor" :class="{ 'cel-editor--invalid': !!diagnostic }">
    <div ref="hostRef" class="cel-editor__host"></div>
  </div>
</template>

<script setup lang="ts">
/**
 * CEL 拼法表达式编辑器（CodeMirror 6）
 *
 * - 语法高亮：紧凑 StreamLanguage 词法（字符串/数字/变量/关键字/运算符）
 * - 实时校验：@codemirror/lint 接 celExpression.validatePatchExpr（解析 +
 *   全档位试算），错误行内标注
 * - 主题：vscode 暗/浅双主题经 Compartment 热替换（对齐 CodeMirrorEditor 的
 *   主题挂载不固化做法）
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  drawSelection,
  placeholder as cmPlaceholder,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  StreamLanguage,
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
  type StringStream,
} from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode'
import { useTheme } from '@/composables/useTheme'
import {
  validatePatchExpr,
  type CelDiagnostic,
} from '@/utils/celExpression'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** 校验结果（null = 通过）；父组件据此提示/预览 */
  'diagnostic': [value: CelDiagnostic | null]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

/** 本地校验态（边框标红 + 对外 emit 同一份） */
const diagnostic = ref<CelDiagnostic | null>(null)
const applyDiagnostic = (text: string) => {
  diagnostic.value = validatePatchExpr(text)
  emit('diagnostic', diagnostic.value)
}

/** 表达式可用变量（与后端 PATCH_EXPR_VARIABLES 同集） */
const KNOWN_VARIABLES = new Set([
  'reasoningLevel',
  'wireValue',
  'mappedWire',
  'offWire',
  'off',
  'on',
])

/** 紧凑 CEL 词法：字符串/数字/布尔与 null/变量/关键字/运算符/括号 */
const celLanguage = StreamLanguage.define({
  name: 'cel',
  token(stream: StringStream) {
    if (stream.eatSpace()) return null
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number'
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) {
      const word = stream.current()
      if (word === 'true' || word === 'false' || word === 'null') return 'atom'
      if (word === 'in') return 'keyword'
      if (KNOWN_VARIABLES.has(word)) return 'variableName.special'
      return 'variableName'
    }
    if (stream.match(/^(==|!=|<=|>=|&&|\|\||[?:+\-*/%<>!])/)) return 'operator'
    if (stream.match(/^[{}()[\]]/)) return 'bracket'
    if (stream.match(/^[,.]/)) return 'punctuation'
    stream.next()
    return null
  },
})

const { isDark } = useTheme()
const themeCompartment = new Compartment()
const currentTheme = () => (isDark.value ? vscodeDark : vscodeLight)

const celLinter = linter(
  (view) => {
    const text = view.state.doc.toString()
    const diag = validatePatchExpr(text)
    if (!diag) return []
    const from = Math.min(diag.start ?? 0, view.state.doc.length)
    const to = Math.min(diag.end ?? view.state.doc.length, view.state.doc.length)
    return [
      {
        from,
        to: Math.max(from, to),
        severity: 'error',
        message: diag.message,
      } as Diagnostic,
    ]
  },
  { delay: 350 },
)

function buildState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      bracketMatching(),
      closeBrackets(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
      celLanguage,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      celLinter,
      cmPlaceholder(props.placeholder ?? ''),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const text = update.state.doc.toString()
          emit('update:modelValue', text)
          applyDiagnostic(text)
        }
      }),
      EditorView.theme({
        '&': { fontSize: '12px' },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: 'var(--gd-font-mono, monospace)',
          lineHeight: '1.6',
        },
        '.cm-content': { padding: '6px 0' },
        '.cm-gutters': { display: 'none' },
        '&.cm-focused': { outline: 'none' },
      }),
      themeCompartment.of(currentTheme()),
    ],
  })
}

onMounted(() => {
  if (!hostRef.value) return
  view = new EditorView({
    state: buildState(props.modelValue),
    parent: hostRef.value,
  })
  // 初始内容也校验一次（回显已有表达式时父组件能拿到诊断）
  applyDiagnostic(props.modelValue)
})

// 外部内容变化（模板回填 / 切换模型）→ 替换文档
watch(
  () => props.modelValue,
  (val) => {
    if (view && val !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: val },
      })
    }
  },
)

watch(isDark, () => {
  view?.dispatch({ effects: themeCompartment.reconfigure(currentTheme()) })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<style scoped>
.cel-editor {
  border: 1px solid var(--gd-color-border);
  border-radius: 6px;
  background: var(--gd-color-surface, transparent);
  max-width: 480px;
  transition: border-color 0.15s;
}

.cel-editor--invalid {
  border-color: var(--el-color-danger);
}

.cel-editor__host {
  height: 108px;
}

.cel-editor :deep(.cm-editor) {
  height: 100%;
}

.cel-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}

.cel-editor :deep(.cm-tooltip) {
  font-size: 12px;
}
</style>
