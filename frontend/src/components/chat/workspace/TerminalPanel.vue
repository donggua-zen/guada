<template>
    <div class="terminal-panel">
        <!-- 终端容器 -->
        <div ref="terminalRef" class="terminal-container"></div>
        <!-- 错误横幅（node-pty 不可用等） -->
        <div v-if="errorHint" class="terminal-error-banner">
            <span>{{ errorHint }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { TerminalSocketService } from "@/services/modules/TerminalSocketService";
import { useTheme } from "@/composables/useTheme";
import type { ServerTerminalMessage } from "@/types/terminal.types";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

const props = defineProps<{
    sessionId: string;
    terminalId?: string;
    /** 是否为当前激活的终端标签（非激活面板常驻挂载但隐藏，只在激活时抢焦点） */
    isActive?: boolean;
}>();

const emit = defineEmits<{
    "terminal-id": [terminalId: string];
}>();

const token = ref(localStorage.getItem("token") || sessionStorage.getItem("token") || "");
const terminalSocket = new TerminalSocketService();
const { isDark } = useTheme();
const terminalRef = ref<HTMLDivElement | null>(null);
const errorHint = ref("");

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let disposers: Array<() => void> = [];
/** 已卸载：阻止 openWhenSized 的 RAF 在卸载后再排队（否则空转 60fps） */
let disposed = false;

// xterm 主题（跟随 --gd-* token）
const xtermTheme = computed(() => ({
    background: isDark.value ? "#1e1e1e" : "#ffffff",
    foreground: isDark.value ? "#d4d4d4" : "#333333",
    cursor: isDark.value ? "#ffffff" : "#000000",
    selectionBackground: isDark.value ? "rgba(38, 79, 120, 0.5)" : "rgba(181, 213, 255, 0.5)",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#e5e5e5",
}));

// 主题切换时热更新终端配色：xterm 主题同样在创建时固化，
// 官方支持运行时改 options.theme（立即重绘，不影响缓冲区内容）
watch(isDark, () => {
    if (term) term.options.theme = xtermTheme.value;
});

// 切换标签：本面板从隐藏变为激活 → 补一次 fit（隐藏期间侧栏宽度可能变过，几何由
// ResizeObserver 持续跟踪，这里只兜底）并聚焦；隐藏面板会失去 DOM 焦点，不补 focus 就没法直接打字
watch(() => props.isActive, (active) => {
    if (!active || !term) return;
    try {
        fitAddon?.fit();
    } catch {
        /* ignore：容器尚未布局 */
    }
    term.focus();
});

async function initTerminal() {
    if (!terminalRef.value) return;

    // 懒加载 xterm + CSS（CSS 必须加载，否则双光标/无法输入）
    const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
    ]);
    await import("@xterm/xterm/css/xterm.css");

    const t = new Terminal({
        theme: xtermTheme.value,
        fontFamily: "var(--gd-font-mono, 'Courier New', monospace)",
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    t.loadAddon(fitAddon);

    // 去重缓存：只挡真正的重复 resize
    let lastCols = 0;
    let lastRows = 0;
    const sendResize = (cols: number, rows: number) => {
        if (!t.element || cols <= 0 || rows <= 0) return;
        if (cols === lastCols && rows === lastRows) return;
        lastCols = cols;
        lastRows = rows;
        terminalSocket.resize(cols, rows);
    };

    // 连接 WS：必须在首次 fit 之后调用（URL 携带真实 cols/rows，
    // 后端 spawn PTY 才能按正确几何创建，而不是 80×24 默认值）
    const connectSocket = () => {
        terminalSocket.connect(token.value, props.sessionId, {
            terminalId: props.terminalId,
            cols: t.cols,
            rows: t.rows,
            onTerminalId: (id) => emit("terminal-id", id),
        });
    };

    // 只在容器有真实尺寸后 open，避免隐藏/切换标签时 xterm renderer 尺寸为 0。
    // WS 连接也放在这里：fit 之后才拿得到真实 cols/rows。
    let rafId = 0;
    const openWhenSized = () => {
        if (disposed) return;
        if (!terminalRef.value || terminalRef.value.clientWidth <= 0 || terminalRef.value.clientHeight <= 0) {
            rafId = requestAnimationFrame(openWhenSized);
            return;
        }
        t.open(terminalRef.value);
        // openWhenSized 仅在 initTerminal 末尾（fitAddon 已赋值后）首次执行
        fitAddon!.fit();
        // 非激活面板常驻挂载（切换标签不重建，避免重连竞态）：隐藏时不要抢焦点
        if (props.isActive) t.focus();
        connectSocket();
    };
    // 卸载时取消未执行的帧（否则容器一直没尺寸时 RAF 会无限排队空转）
    disposers.push(() => cancelAnimationFrame(rafId));

    // 先注册所有 xterm 监听，再 open/fit/连接 WS；对齐 DSH 的初始化顺序。
    // 否则切换会话/刷新时 xterm 产生的 DA 应答可能在监听器建立前丢失，
    // 造成 shell 与终端状态不同步。
    disposers.push(
        terminalSocket.onMessage((msg: ServerTerminalMessage) => {
            handleMessage(msg);
        }),
    );

    // DA（Device Attributes）应答是 xterm 生成的合法协议数据，
    // 必须原样转发给 shell，否则 shell 与终端状态不同步。
    t.onData((data: string) => {
        terminalSocket.input(data);
    });

    t.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        sendResize(cols, rows);
    });

    const ro = new ResizeObserver(() => {
        if (fitAddon && t.element && terminalRef.value?.clientWidth && terminalRef.value?.clientHeight) {
            fitAddon.fit();
            sendResize(t.cols, t.rows);
        }
    });
    ro.observe(terminalRef.value);
    disposers.push(() => ro.disconnect());

    // WS 连接成功（open）后立即 fit + 强制发送一次尺寸。
    // 注意必须清空去重缓存：首次 fit 触发的 resize 发生在 WS 打开前，
    // 会被 send() 静默丢弃但已写入 lastCols/lastRows，不清零的话这里
    // 会被误判为重复而跳过，PTY 将停留在错误几何直到手动调整窗口。
    disposers.push(
        terminalSocket.onStatus((s) => {
            if (s === "open" && t.element) {
                try {
                    // onStatus("open") 仅在 initTerminal 建连流程后才可能触发（fitAddon 已赋值）
                    fitAddon!.fit();
                } catch {
                    /* ignore */
                }
                lastCols = 0;
                lastRows = 0;
                sendResize(t.cols, t.rows);
            }
        }),
    );

    // 最后 open + fit + 连接：此时 xterm 的输入、resize、消息监听均已就绪。
    openWhenSized();
    term = t;
}

function handleMessage(msg: ServerTerminalMessage) {
    switch (msg.type) {
        case "transcript":
        case "output":
            // 剥离 DA 应答序列（ESC[?1;2c / ESC[?6c）。
            // DA 应答是终端与 shell 的握手过程数据，实时产生时已由
            // xterm onData 即时转发；出现在输出/回放中只会显示成
            // "^[[?1;2c" 污染画面，且无任何历史意义。
            term?.write(stripTerminalHandshake(msg.text));
            break;
        case "exit":
            term?.write(`\r\n\x1b[31m[进程退出，代码 ${msg.code}]\x1b[0m\r\n`);
            break;
        case "error":
            errorHint.value = msg.message + (msg.fixHint ? ` — ${msg.fixHint}` : "");
            break;
    }
}

/** 从终端输出/回放中剥离 DA（Device Attributes）应答等握手序列 */
function stripTerminalHandshake(text: string): string {
    // 完整 DA 应答（ESC 形式）
    let s = text.replace(/\x1b\[\?1;2c/g, "").replace(/\x1b\[\?6c/g, "");
    // 已被 shell 回显为可见文本的形式（^[ = ESC 显示转义，^[ 或 ^[）
    s = s.replace(/\^\[\[\?1;2c/g, "").replace(/\^\[\[\?6c/g, "");
    return s;
}

onMounted(() => {
    nextTick(() => initTerminal());
    // 容器点击时 focus（防止焦点被其他元素抢走）
    nextTick(() => {
        if (terminalRef.value) {
            terminalRef.value.addEventListener("click", () => term?.focus());
        }
    });
});

onBeforeUnmount(() => {
    // 会话切换/面板卸载只断开 WS，不销毁 PTY；关闭标签由父层显式 dispose
    disposed = true;
    terminalSocket.disconnect();
    disposers.forEach((d) => d());
    disposers = [];
    term?.dispose();
    term = null;
});
</script>

<style scoped>
.terminal-panel {
    /* 绝对定位填充父容器；通过 box-sizing 保证边距不把面板撑出边界 */
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    box-sizing: border-box;
    padding: 8px;
    background: var(--gd-color-surface, #fff);
    overflow: hidden;
}
.terminal-container {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    background: var(--gd-color-bg, #fff);
    overflow: hidden;
    overscroll-behavior: contain;
    position: relative;
}

/* xterm 自身使用 absolute viewport。不要修改 right 偏移，
 * 否则 xterm 的 scroll-area 宽度可能溢出并生成底部横向滚动条。
 * 用 scrollbar-gutter 预留竖向滚动条空间即可。
 * 必须覆盖 xterm.css 的默认纯黑背景：项目滚动条 thumb 是半透明黑，
 * 叠在黑背景上会完全不可见，看起来像"默认黑色滚动条"。 */
.terminal-container :deep(.xterm) {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
}
.terminal-container :deep(.xterm-viewport) {
    right: 0;
    overflow-x: hidden !important;
    overflow-y: scroll !important;
    background-color: var(--gd-color-bg, #fff) !important;
    scrollbar-gutter: stable;
}
.terminal-error-banner {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 6px 12px;
    background: var(--gd-color-danger-bg, #fef0f0);
    color: var(--gd-color-danger, #f56c6c);
    font-size: 12px;
    border-bottom: 1px solid var(--gd-color-danger-border, #fde2e2);
    z-index: 10;
}
</style>
