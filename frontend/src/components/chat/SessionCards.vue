<template>
  <!-- 会话级全局统一交互卡（对齐 DSH：sessionId 唯一锚点，不挂回合）。
       审批（kind=approval，ask 特例）/ 询问（kind=ask）
       共用一张卡：多问题分页（右上箭头翻页）、选项按钮 + 常驻自定义输入行、
       单击选项仅"选中"（不提交、不自动翻页），双击选项或点「提交」才提交（防误触）；
       「忽略」= 不回答并停止当前轮（后端仅有"用户停止"能终结一次待答）。
       提交后按 requestId 凭证回传匹配等待者，无超时。 -->
  <div class="session-cards w-full flex flex-col gap-2">
    <!-- :duration 显式给时长：transitionend 不可靠时（后台标签页 rAF 冻结、元素曾处于
         不可见容器等）Vue 也会按定时器移除节点，避免卡片卡在过渡里以 opacity:0 残留并占住布局 -->
    <Transition name="card-slide" :duration="200">
      <div v-if="askCtx"
        class="ask-card w-full bg-(--gd-color-surface) border border-(--gd-color-surface-border) rounded-(--gd-size-dialog-rounded-radius) px-4 py-3 shadow-sm"
        @keydown="onOptionsKeydown">
        <!-- 头部：kind 分支标题 + 卡片标题 + 右端分页器 -->
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
            :class="kindBadgeClass">
            {{ kindTitle }}
          </span>
          <span v-if="askCtx.title" class="min-w-0 truncate text-sm font-medium text-gray-800 dark:text-[#e5e7eb]">
            {{ askCtx.title }}
          </span>
          <span class="flex-1"></span>
          <!-- 分页器（对齐 ZCode：翻页只走箭头，选完不自动翻；单页为禁用态） -->
          <span class="shrink-0 flex items-center gap-1 text-xs text-gray-400">
            <button class="ask-page-btn" :disabled="pageIdx === 0" @click="prevPage">
              <el-icon :size="12">
                <ChevronLeft20Regular />
              </el-icon>
            </button>
            <span class="tabular-nums">{{ pageIdx + 1 }}/{{ total }}</span>
            <button class="ask-page-btn" :disabled="isLast" @click="nextPage">
              <el-icon :size="12">
                <ChevronRight20Regular />
              </el-icon>
            </button>
          </span>
        </div>

        <!-- 工具行：其它询问/审批保留工具名便于辨认；计划审批不显示
             （标题已说明来意，ExitPlanMode 对用户是噪音） -->
        <div v-if="askCtx.toolName && !isPlanApproval"
          class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span class="rounded px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-xs font-mono">
            {{ askCtx.toolName }}
          </span>
        </div>

        <!-- 当前问题 -->
        <div v-if="question" class="mt-2">
          <div class="text-sm text-gray-800 dark:text-[#e5e7eb]">{{ question.question }}</div>
          <!-- 计划审批（ExitPlanMode）的 detail 是计划全文，刻意不在弹窗内渲染：
               计划本体在流内计划卡（随消息滚动），完整文档从那里打开工作区计划面板；
               此处仅按 isPlanApproval 门控，避免全文落进下方纯文本分支铺开 -->
          <div v-if="question.detail && !isPlanApproval"
            class="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-all">
            {{ question.detail }}
          </div>

          <!-- 选项 + 常驻自定义输入行：单击/上下键 = 移动选取（移动即选，对齐 ZCode 的选取框语义），
               双击/回车/「提交」= 提交；键盘处理挂在整卡上（见 onOptionsKeydown） -->
          <div ref="optionsEl" class="mt-2 flex flex-col gap-1.5">
            <button v-for="(opt, i) in question.options" :key="opt.label"
              class="ask-option"
              :class="{ 'ask-option-active': isSelected(opt.label) }"
              :data-ask-option="i"
              @click="selectOption(opt.label)"
              @dblclick="submitOption(opt.label)">
              <span class="font-mono text-xs opacity-60">{{ i + 1 }}.</span>
              <span class="flex-1 text-left text-sm">{{ opt.label }}</span>
              <span v-if="opt.description" class="text-xs opacity-60">{{ opt.description }}</span>
            </button>

            <!-- 自定义回复：常驻输入行，直接输入即作答（单选与选项互斥，多选为附加） -->
            <div class="ask-option ask-option-input" :class="{ 'ask-option-active': currentCustom }"
              @click="focusCustomInput">
              <span class="font-mono text-xs opacity-60">{{ question.options.length + 1 }}.</span>
              <input ref="customInputEl" v-model="customText" class="ask-custom-input"
                :placeholder="t('chat.ask.customReply')" @input="handleCustomInput" />
            </div>
          </div>

          <!-- 页脚：键盘提示 + 忽略/主操作（常驻显示） -->
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span class="ask-hint">{{ t('chat.ask.keyboardHint') }}</span>
            <div class="flex items-center gap-2">
              <el-button size="small" :disabled="busy" :title="t('chat.ask.ignoreTip')" @click="ignoreAsk">
                {{ t('chat.ask.ignore') }}
              </el-button>
              <el-button type="primary" size="small" :loading="busy" @click="primaryAction">
                {{ isLast ? t('chat.ask.submit') : t('chat.ask.next') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { computed, nextTick, ref, watch } from "vue";
import { ElButton, ElIcon } from "element-plus";
import { ChevronLeft20Regular, ChevronRight20Regular } from "@vicons/fluent";
import { useI18n } from "vue-i18n";
import { apiService } from "@/services/ApiService";
import { useSessionStore } from "@/stores/session";
import { usePopup } from "../../composables/usePopup";

const props = defineProps<{
  sessionId?: string;
}>();

const emit = defineEmits<{
  /** 忽略：不回答，交由宿主停止当前轮（后端仅有"用户停止"能终结一次待答） */
  ignore: [];
}>();

const sessionStore = useSessionStore();
const { toast } = usePopup();
const { t } = useI18n();

// ── 会话级统一交互卡（ask_requested 标记；ask_resolved / turn_end 清除）──

const askCtx = computed(() => sessionStore.sessionPendingAsk(props.sessionId || ""));

/** 当前问题页（多问题分页：箭头/「下一步」翻页；单击选项不再自动翻页） */
const pageIdx = ref(0);
const busy = ref(false);
/** 各题答案（按问题 id 收集；selected 为选项 label，custom 为自定义回复） */
const answers = ref<Record<string, { selected: string[]; custom?: string }>>({});
/** 自定义输入行内容（常驻输入框；翻页时载入该题已填文本） */
const customText = ref("");
const optionsEl = ref<HTMLElement | null>(null);
const customInputEl = ref<HTMLInputElement | null>(null);

// 新请求到达（requestId 变化）→ 重置分页与答案，并把焦点交给卡片：
// 全局 `* { outline: none !important }` 禁掉了焦点环，若焦点留在 body，Tab/上下键看着"没反应"。
watch(
  () => askCtx.value?.requestId,
  () => {
    pageIdx.value = 0;
    answers.value = {};
    customText.value = "";
    if (askCtx.value) autoFocusCard();
  },
  { immediate: true },
);

const question = computed(() => askCtx.value?.questions[pageIdx.value]);
const total = computed(() => askCtx.value?.questions.length ?? 0);
const isLast = computed(() => pageIdx.value >= total.value - 1);

// 翻页 → 输入行载入该题的自定义回复（每题的草稿互不串扰）
watch(pageIdx, () => {
  customText.value = answers.value[question.value?.id ?? ""]?.custom ?? "";
});

const kindTitle = computed(() => {
  if (askCtx.value?.kind === "approval") return t("chat.ask.approval");
  return t("chat.ask.input");
});
const kindBadgeClass = computed(() =>
  askCtx.value?.kind === "ask"
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
    : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
);

/** 计划审批（ExitPlanMode 的 approval）：其 detail 是计划全文，弹窗内不渲染（见模板注释） */
const isPlanApproval = computed(
  () => askCtx.value?.kind === "approval" && askCtx.value?.toolName === "ExitPlanMode",
);

function isSelected(label: string): boolean {
  return answers.value[question.value?.id ?? ""]?.selected.includes(label) ?? false;
}
const currentCustom = computed(
  () => answers.value[question.value?.id ?? ""]?.custom !== undefined,
);

/** 单击选项：只选中（单选点选即选中该项并清空自定义；多选切换勾选），不提交不翻页 */
function selectOption(label: string) {
  const q = question.value;
  if (!q || busy.value) return;
  const prev = answers.value[q.id] || { selected: [] };
  if (q.multiSelect) {
    const selected = prev.selected.includes(label)
      ? prev.selected.filter((l) => l !== label)
      : [...prev.selected, label];
    answers.value[q.id] = { ...prev, selected };
  } else {
    answers.value[q.id] = { selected: [label] };
    customText.value = "";
  }
}

/** 双击选项：选中该项并直接提交（对齐"单击选中、双击提交"，避免误触直接提交） */
function submitOption(label: string) {
  const q = question.value;
  if (!q || busy.value) return;
  const prev = answers.value[q.id] || { selected: [] };
  if (q.multiSelect) {
    // 双击的两次 click 已把勾选切换回原状：这里显式确保该项被选中
    answers.value[q.id] = {
      ...prev,
      selected: prev.selected.includes(label) ? prev.selected : [...prev.selected, label],
    };
  } else {
    answers.value[q.id] = { selected: [label] };
    customText.value = "";
  }
  void submit();
}

/** 自定义输入行：直接输入即作答（单选与选项互斥；多选为附加）；清空则撤销自定义 */
function handleCustomInput() {
  const q = question.value;
  if (!q) return;
  const prev = answers.value[q.id] || { selected: [] };
  const text = customText.value.trim();
  answers.value[q.id] = {
    selected: q.multiSelect ? prev.selected : [],
    ...(text ? { custom: text } : {}),
  };
}

function focusCustomInput() {
  customInputEl.value?.focus();
}

/** 卡片接管键盘焦点：只在"焦点无主"（body/已失效）或仍停在即将隐藏的输入区时抢占，
 *  避免把用户在别处（如侧栏输入框）的焦点抢走 */
function autoFocusCard() {
  const el = document.activeElement as HTMLElement | null;
  const shouldTake =
    !el || el === document.body || !el.isConnected || !!el.closest(".chat-input-area");
  if (shouldTake) focusFirstOption();
}

/** 焦点落到第一个选项（卡片出现/翻页后），上下键与 Tab 立即可用 */
function focusFirstOption() {
  void nextTick(() => {
    optionsEl.value?.querySelector<HTMLElement>("[data-ask-option]")?.focus();
  });
}

/** 卡片键盘（对齐 ZCode 交互、非"移动焦点"）：
 *  - 上下键 = 移动"选取框"，单选移动即选（移到输入行只落焦点）；
 *  - 回车 = 提交（当前题有选取或自定义输入才提交，都没有时空转，防误触）；
 *  - Tab / 空格 = 按钮原生行为（Tab 移焦点、空格=点击=选取）；
 *  - 「忽略」「提交」按钮自身的回车交给原生激活，不重复触发。 */
function onOptionsKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  if (e.key === "Enter") {
    // 输入法组合中的回车不当作提交
    if (e.isComposing || e.keyCode === 229) return;
    if (target.closest(".el-button") || target.closest(".ask-page-btn")) return;
    e.preventDefault();
    submitCurrent();
    return;
  }

  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const focusables = [
    ...Array.from(optionsEl.value?.querySelectorAll<HTMLElement>("[data-ask-option]") ?? []),
    ...Array.from(optionsEl.value?.querySelectorAll<HTMLElement>(".ask-custom-input") ?? []),
  ];
  if (focusables.length === 0) return;
  e.preventDefault();
  const delta = e.key === "ArrowDown" ? 1 : -1;
  const idx = focusables.indexOf(target);
  const next =
    idx === -1
      ? delta === 1
        ? 0
        : focusables.length - 1
      : Math.min(focusables.length - 1, Math.max(0, idx + delta));
  const el = focusables[next];
  el?.focus();
  // 单选：移动到选项行即选中该行（多选只移动光标，空格再勾选）
  const optIdx = el?.getAttribute("data-ask-option");
  const q = question.value;
  if (optIdx != null && q && !q.multiSelect) {
    const opt = q.options[Number(optIdx)];
    if (opt) selectOption(opt.label);
  }
}

/** 回车提交：当前题有选取或有自定义输入才走主操作（末页提交/中间页下一步），否则空转 */
function submitCurrent() {
  const q = question.value;
  if (!q || busy.value) return;
  const a = answers.value[q.id];
  if (!a || (a.selected.length === 0 && !a.custom)) return;
  primaryAction();
}

function prevPage() {
  if (pageIdx.value > 0) {
    pageIdx.value -= 1;
    focusFirstOption();
  }
}
function nextPage() {
  if (pageIdx.value < total.value - 1) {
    pageIdx.value += 1;
    focusFirstOption();
  }
}
/** 主按钮：末页提交，未到末页先翻页（多问题时） */
function primaryAction() {
  if (isLast.value) void submit();
  else nextPage();
}
/** 忽略：不回答、停止当前轮（宿主接 abort；卡片由 ask_resolved 帧清除） */
function ignoreAsk() {
  if (!busy.value) emit("ignore");
}

async function submit() {
  if (!askCtx.value || !props.sessionId || busy.value) return;
  busy.value = true;
  try {
    const requestId = askCtx.value.requestId;
    if (!requestId) {
      toast.error(t("chat.ask.staleCredential"));
      return;
    }
    // 按问题单顺序整理答案批：未作答的题以空答案占位（保持逐 id 对应）
    const payload = askCtx.value.questions.map((q) => {
      const a = answers.value[q.id];
      return { id: q.id, selected: a?.selected ?? [], ...(a?.custom ? { custom: a.custom } : {}) };
    });
    await apiService.respond(props.sessionId, requestId, payload);
    // 卡片由 ask_resolved 帧（projector）清除；多窗口同步收卡
  } catch (e) {
    toast.error(getErrorMessage(e) || t("chat.ask.submitFailed"));
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.ask-option {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  width: 100%;
  padding: 0.375rem 0.625rem;
  border-radius: 0.375rem;
  border: 1px solid var(--gd-color-surface-border, rgba(0, 0, 0, 0.08));
  background: transparent;
  color: inherit;
  text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.ask-option:hover {
  background: rgba(0, 0, 0, 0.04);
}
.dark .ask-option:hover {
  background: rgba(255, 255, 255, 0.06);
}
.ask-option-active {
  border-color: var(--gd-color-primary);
  background: var(--gd-color-primary-100);
}

/* 焦点指示：全局 `* { outline: none !important }` 关掉了原生焦点环，卡片自绘——
   选中 = 主色描边 + 浅底；焦点 = 仅主色描边（细一档，不叠环，避免过重）。
   用 :focus 而非 :focus-visible：程序化聚焦/鼠标点选也显示，焦点永远看得见 */
.ask-option:focus {
  border-color: var(--gd-color-primary);
}
.ask-option-input:focus-within {
  border-color: var(--gd-color-primary);
}
.ask-page-btn:focus,
.ask-card :deep(.el-button:focus) {
  box-shadow: 0 0 0 1px var(--gd-color-primary);
}

/* 自定义输入行：与选项行同构，输入框常驻、可直接输入 */
.ask-option-input {
  align-items: center;
  cursor: text;
}
.ask-custom-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  font: inherit;
  color: inherit;
}
.ask-custom-input::placeholder {
  color: var(--gd-color-text-gray, #9ca3af);
}

/* 翻页箭头（问题 >1 页可点，单页为禁用态） */
.ask-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.ask-page-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* 页脚键盘提示（上下键移动选取、回车提交；Tab 仍在但不写进提示——它只移焦点，与上下键语义不同） */
.ask-hint {
  font-size: 0.6875rem;
  /* 整数行高：11px 继承 1.5 会得到 16.5px 半像素行盒 */
  line-height: 16px;
  color: var(--gd-color-text-gray, #9ca3af);
}

.card-slide-enter-active,
.card-slide-leave-active {
  transition: all 0.2s ease;
}
.card-slide-enter-from,
.card-slide-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

/* 卡片限高 + 内部滚动（对齐 ZCode 对话框 max-h-[min(72dvh,42rem)]）：
   弹窗顶替输入区位置，绝不超过视口——问题多/选项长时在卡内滚动，而不是把消息区挤没 */
.ask-card {
  max-height: min(60vh, 32rem);
  overflow-y: auto;
}
</style>
