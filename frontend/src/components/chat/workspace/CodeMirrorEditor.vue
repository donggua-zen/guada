<template>
    <div class="codemirror-host w-full h-full" ref="hostRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, dropCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, defaultHighlightStyle, type LanguageSupport } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { useTheme } from '@/composables/useTheme';

const props = defineProps<{
    modelValue: string;
    extension: string; // 文件扩展名，如 '.ts'
    readOnly?: boolean;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string];
    'save': [value: string];
}>();

const hostRef = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

// 根据扩展名选语言
function languageForExt(ext: string) {
    const map: Record<string, () => LanguageSupport> = {
        '.html': html, '.htm': html, '.css': css, '.scss': css, '.less': css,
        '.js': () => javascript({ jsx: false }), '.mjs': () => javascript({ jsx: false }),
        '.ts': () => javascript({ jsx: true, typescript: true }),
        '.jsx': () => javascript({ jsx: true }), '.tsx': () => javascript({ jsx: true, typescript: true }),
        '.json': json, '.md': markdown, '.markdown': markdown,
        '.py': python, '.cpp': cpp, '.c': cpp, '.h': cpp, '.hpp': cpp,
        '.java': java, '.rs': rust, '.sql': sql, '.xml': xml, '.yaml': yaml, '.yml': yaml,
    };
    const factory = map[ext.toLowerCase()];
    return factory ? factory() : undefined;
}

const { isDark } = useTheme();

// 主题经 Compartment 注入：主题固化在 EditorState 里，切换暗/浅色时只能用
// reconfigure 效果热替换这一段扩展（文档、撤销历史、滚动位置、选区全部保留）
const themeCompartment = new Compartment();
const currentTheme = () => (isDark.value ? vscodeDark : vscodeLight);

function buildState(doc: string, extension: string) {
    const langSupport = languageForExt(extension);
    return EditorState.create({
        doc,
        extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            history(),
            foldGutter(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            rectangularSelection(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            keymap.of([
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...searchKeymap,
                ...historyKeymap,
                ...completionKeymap,
                indentWithTab,
                // Ctrl+S / Cmd+S 保存
                { key: 'Mod-s', run: () => { emit('save', view?.state.doc.toString() ?? ''); return true; } },
            ]),
            autocompletion(),
            langSupport ?? [],
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    emit('update:modelValue', update.state.doc.toString());
                }
            }),
            EditorView.theme({
                '&': { height: '100%', fontSize: '14px' },
                '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--gd-font-mono, monospace)' },
            }),
            // 主题（暗色跟随系统）
            themeCompartment.of(currentTheme()),
        ],
    });
}

onMounted(() => {
    if (!hostRef.value) return;
    const state = buildState(props.modelValue, props.extension);
    view = new EditorView({ state, parent: hostRef.value });
});

// 外部内容变化（如切换文件）→ 替换文档
watch(() => props.modelValue, (val) => {
    if (view && val !== view.state.doc.toString()) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: val } });
    }
});

// 主题切换（手动暗/浅或"跟随系统"变化）→ 热替换主题扩展
watch(isDark, () => {
    view?.dispatch({ effects: themeCompartment.reconfigure(currentTheme()) });
});

onBeforeUnmount(() => {
    view?.destroy();
    view = null;
});

// 选区读取：CodeMirror 自己管理选区，父组件的 window.getSelection() 取不到，
// 右键"加入会话"需要靠它拿到文本与起止行号
defineExpose({
    getSelectionInfo(): { text: string; startLine: number; endLine: number } | null {
        if (!view) return null;
        const range = view.state.selection.main;
        if (range.empty) return null;
        return {
            text: view.state.sliceDoc(range.from, range.to),
            startLine: view.state.doc.lineAt(range.from).number,
            endLine: view.state.doc.lineAt(range.to).number,
        };
    },
});
</script>

<style scoped>
.codemirror-host {
    width: 100%;
    height: 100%;
    overflow: hidden;
}
</style>
