<template>
  <!-- 会话级全局统一交互卡（对齐 DSH：sessionId 唯一锚点，不挂回合）。
       审批（kind=approval，ask 特例）/ 询问（kind=ask）
       共用一张卡：多问题分页（单选点选自动翻页、多选勾选后"下一步"）、
       选项按钮 + 自定义回复（提交后按 requestId 凭证回传匹配等待者，无超时）。 -->
  <div class="session-cards flex flex-col gap-2">
    <Transition name="card-slide">
      <div v-if="askCtx"
        class="ask-card bg-(--gd-color-surface) border border-(--gd-color-surface-border) rounded-(--gd-size-dialog-rounded-radius) px-4 py-3 shadow-sm">
        <!-- 头部：kind 分支标题 + 卡片标题 -->
        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
            :class="kindBadgeClass">
            {{ kindTitle }}
          </span>
          <span v-if="askCtx.title" class="text-sm font-medium text-gray-800 dark:text-[#e5e7eb]">
            {{ askCtx.title }}
          </span>
        </div>

        <!-- 工具行（"命令…"） -->
        <div v-if="askCtx.toolName"
          class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span class="rounded px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 text-xs font-mono">
            {{ askCtx.toolName }}
          </span>
        </div>

        <!-- 当前问题（分页 i/N） -->
        <div v-if="question" class="mt-2">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-sm text-gray-800 dark:text-[#e5e7eb]">{{ question.question }}</span>
            <span v-if="total > 1" class="shrink-0 text-xs text-gray-400">{{ pageIdx + 1 }}/{{ total }}</span>
          </div>
          <div v-if="question.detail" class="mt-1 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-all">
            {{ question.detail }}
          </div>

          <!-- 选项按钮（A/B/C… 按序；单选点选即翻页，多选点选切换勾选） -->
          <div class="mt-2 flex flex-col gap-1.5">
            <button v-for="(opt, i) in question.options" :key="opt.label"
              class="ask-option"
              :class="{ 'ask-option-active': isSelected(opt.label) }"
              @click="selectOption(opt.label)">
              <span class="font-mono text-xs opacity-60">{{ letter(i) }}</span>
              <span class="flex-1 text-left text-sm">{{ opt.label }}</span>
              <span v-if="opt.description" class="text-xs opacity-60">{{ opt.description }}</span>
            </button>

            <!-- 自定义回复（末位选项；填写后单选与 selected 互斥） -->
            <button v-if="!customActive"
              class="ask-option"
              :class="{ 'ask-option-active': currentCustom }"
              @click="startCustom">
              <span class="font-mono text-xs opacity-60">{{ letter(question.options.length) }}</span>
              <span class="flex-1 text-left text-sm">{{ t('chat.ask.customReply') }}</span>
            </button>
            <div v-else class="flex items-start gap-2">
              <el-input v-model="customText" type="textarea" :rows="2" autofocus
                :placeholder="t('chat.ask.customReply')" @keydown.enter.exact.prevent="confirmCustom" />
              <div class="flex flex-col gap-1">
                <el-button type="primary" size="small" :disabled="!customText.trim()" @click="confirmCustom">
                  {{ t('common.confirm') }}
                </el-button>
                <el-button size="small" @click="cancelCustom">{{ t('common.cancel') }}</el-button>
              </div>
            </div>
          </div>

          <!-- 多选/末页翻页脚（单选点选即翻页，无需脚部） -->
          <div v-if="needFooter" class="mt-2 flex justify-end">
            <el-button type="primary" size="small" :loading="busy" @click="next">
              {{ isLast ? t('chat.ask.submit') : t('chat.ask.next') }}
            </el-button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { getErrorMessage } from '@/utils/errorMessage'
import { computed, ref, watch } from "vue";
import { ElButton, ElInput } from "element-plus";
import { useI18n } from "vue-i18n";
import { apiService } from "@/services/ApiService";
import { useSessionStore } from "@/stores/session";
import { usePopup } from "../../composables/usePopup";

const props = defineProps<{
  sessionId?: string;
}>();

const sessionStore = useSessionStore();
const { toast } = usePopup();
const { t } = useI18n();

// ── 会话级统一交互卡（ask_requested 标记；ask_resolved / turn_end 清除）──

const askCtx = computed(() => sessionStore.sessionPendingAsk(props.sessionId || ""));

/** 当前问题页（多问题分页：单选点选自动翻页，多选"下一步"） */
const pageIdx = ref(0);
const busy = ref(false);
/** 各题答案（按问题 id 收集；selected 为选项 label，custom 为自定义回复） */
const answers = ref<Record<string, { selected: string[]; custom?: string }>>({});
/** 当前题是否处于自定义输入态 */
const customActive = ref(false);
const customText = ref("");

// 新请求到达（requestId 变化）→ 重置分页与答案
watch(
  () => askCtx.value?.requestId,
  () => {
    pageIdx.value = 0;
    answers.value = {};
    customActive.value = false;
    customText.value = "";
  },
);

const question = computed(() => askCtx.value?.questions[pageIdx.value]);
const total = computed(() => askCtx.value?.questions.length ?? 0);
const isLast = computed(() => pageIdx.value >= total.value - 1);
/** 多选（或自定义输入）才需要"下一步/提交"脚部；单选点选即翻页/提交 */
const needFooter = computed(
  () => question.value?.multiSelect || customActive.value,
);

const kindTitle = computed(() => {
  if (askCtx.value?.kind === "approval") return t("chat.ask.approval");
  return t("chat.ask.input");
});
const kindBadgeClass = computed(() =>
  askCtx.value?.kind === "ask"
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
    : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
);

function letter(i: number): string {
  return String.fromCharCode(65 + i);
}

function isSelected(label: string): boolean {
  return answers.value[question.value?.id ?? ""]?.selected.includes(label) ?? false;
}
const currentCustom = computed(
  () => answers.value[question.value?.id ?? ""]?.custom !== undefined,
);

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
    // 单选：点选即作答（与自定义互斥），末页提交、否则自动翻页
    answers.value[q.id] = { selected: [label], custom: undefined };
    next();
  }
}

function startCustom() {
  customText.value = "";
  customActive.value = true;
}
function cancelCustom() {
  customActive.value = false;
  customText.value = "";
}
function confirmCustom() {
  const q = question.value;
  const text = customText.value.trim();
  if (!q || busy.value || !text) return;
  const prev = answers.value[q.id] || { selected: [] };
  answers.value[q.id] = {
    // 单选：自定义与 selected 互斥；多选：自定义附加于勾选
    selected: q.multiSelect ? prev.selected : [],
    custom: text,
  };
  customActive.value = false;
  customText.value = "";
  next();
}

function next() {
  if (isLast.value) {
    submit();
  } else {
    pageIdx.value += 1;
    customActive.value = false;
    customText.value = "";
  }
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
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
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
</style>
