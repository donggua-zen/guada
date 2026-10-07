<template>
  <!-- 紧凑单行（输入框底部外侧）：主目录（点击打开目录树）+ 附加远程目录 chips + 添加绑定 -->
  <div class="working-dir-bar">
    <button class="wdb-main" :title="mainWorkspacePath || t('chat.workspace.workingDir')"
      @click="openWorkspaceTree">
      <el-icon :size="16" class="wdb-icon"><Folder16Regular /></el-icon>
      <span class="wdb-name">{{ mainWorkspaceBasename || t('chat.workspace.workingDir') }}</span>
    </button>

    <!-- 附加目录：已绑定的远程连接；点击弹信息卡（解绑在卡内，避免 hover 按钮撑宽跳动）。
         连接清单加载期间渲染骨架占位，避免闪原始连接 ID -->
    <template v-for="conn in attachedConnections" :key="conn.id">
      <span v-if="connectionsLoading" class="wdb-attach wdb-attach-skeleton" aria-hidden="true"></span>
      <span v-else class="wdb-attach" @click="openConnCard(conn, $event)">
        <el-icon :size="16" class="wdb-icon"><Cloud16Regular /></el-icon>
        <span class="wdb-name">{{ conn.missing ? t('chat.workspace.unknownConnection') : conn.name }}</span>
      </span>
    </template>

    <!-- 添加附加目录：共享绑定菜单（✓ 为已绑定，点击 toggle 不关闭，点外部收起；空态引导去设置页） -->
    <DropdownMenu>
      <GdTooltip :content="t('chat.workspace.addAttachedDir')" placement="bottom">
        <button class="wdb-add">
          <el-icon :size="12"><Add16Regular /></el-icon>
        </button>
      </GdTooltip>
      <template #dropdown>
        <div class="wdb-menu">
          <ConnectionBindingMenu :attached-ids="attachedIds" @toggle="handleAttachedToggle" />
        </div>
      </template>
    </DropdownMenu>

    <!-- 附加目录信息卡（非模态）：连接基本信息 + 解绑；内边距由实例 wrapper 提供，不动 GdPopover -->
    <GdPopover :show="connCardVisible" @update:show="onConnCardShowChange" :width="260" :anchor-el="connCardAnchor">
      <div v-if="activeConn" class="wdb-card">
        <div class="wdb-card-row">
          <span class="wdb-card-label">{{ t('chat.workspace.connName') }}</span>
          <span class="wdb-card-value">{{ activeConn.missing ? activeConn.id : activeConn.name }}</span>
        </div>
        <div class="wdb-card-row">
          <span class="wdb-card-label">{{ t('chat.workspace.connHost') }}</span>
          <span class="wdb-card-value">{{ activeConn.hostLine }}</span>
        </div>
        <div class="wdb-card-row">
          <span class="wdb-card-label">{{ t('chat.workspace.connPath') }}</span>
          <span class="wdb-card-value">{{ activeConn.path || '-' }}</span>
        </div>
        <div class="wdb-card-row">
          <span class="wdb-card-label">{{ t('chat.workspace.connPerm') }}</span>
          <span class="wdb-card-value">{{ permLabel(activeConn.perm) }}</span>
        </div>
        <button class="wdb-card-unbind" @click="handleUnbind">
          {{ t('chat.workspace.removeAttachedDir') }}
        </button>
      </div>
    </GdPopover>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { Folder16Regular, Cloud16Regular, Add16Regular } from "@vicons/fluent";
import DropdownMenu from "../../ui/DropdownMenu.vue";
import GdTooltip from "../../ui/GdTooltip.vue";
import GdPopover from "../../ui/GdPopover.vue";
import ConnectionBindingMenu from "../chat-input/ConnectionBindingMenu.vue";
import { SSH_CONNECTION_ATTACHMENT_TYPE } from "@/constants";
import { useTabStore } from "@/stores/tab";
import { useLayoutStore } from "@/stores/layout";
import { useRemoteWorkspaceStore, toggleConnectionBinding } from "@/stores/remoteWorkspace";
import { apiService } from "@/services/ApiService";

const props = defineProps<{
  sessionId: string | null;
  /** 主会话的附件绑定（session.settings.attachments 单向下传；增删经事件上行） */
  attachments?: Record<string, string[]>;
}>();
const emit = defineEmits<{
  /** 附加工作目录绑定变更（父层写 session.settings 后 PUT /sessions/:id 持久化） */
  attachmentsChange: [attachments: Record<string, string[]>];
}>();

const { t } = useI18n();
const tabStore = useTabStore();
const layoutStore = useLayoutStore();

// ── 主目录展示（不可删改）+ 附加远程目录（ssh-connection 附件）绑定管理 ──

/** 主工作目录（后端解析：自定义 workspacePath 或会话默认目录），仅展示 */
const mainWorkspacePath = ref("");
const mainWorkspaceBasename = computed(() => {
  if (!mainWorkspacePath.value) return "";
  const normalized = mainWorkspacePath.value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || normalized;
});

interface AttachableConnection {
  id: string;
  name: string;
  /** 信息卡展示：user@host:port */
  hostLine?: string;
  /** 信息卡展示：远程工作目录 */
  path?: string;
  /** 信息卡展示：agent 权限模式 */
  perm?: string;
  /** 绑定仍在但连接清单中已不存在（连接被删除） */
  missing?: boolean;
}

const remoteWorkspaceStore = useRemoteWorkspaceStore();
/**
 * chip 与信息卡的展示信息源。不用 store 的 connectionOptions 投影：那个投影是
 * 绑定入口下拉用的（只含 id/name/description/path），信息卡还要 port 与 perm，
 * 故直接读 store 原始清单——增删改仍共享同一份，设置页新建后此处自动可见。
 */
const availableConnections = computed<AttachableConnection[]>(() =>
  remoteWorkspaceStore.connections.map((c) => ({
    id: c.id,
    name: c.name,
    hostLine: `${c.config.username}@${c.config.host}:${c.config.port}`,
    path: c.config.path,
    perm: c.config.perm,
  })),
);

/** 连接清单加载中：chip 渲染骨架占位，避免闪原始连接 ID；store 已加载过则跳过 */
const connectionsLoading = ref(!remoteWorkspaceStore.hasLoaded);

/** 当前会话已绑定的附加目录 ID（props.attachments 单向下传，增删经 attachmentsChange 上行） */
const attachedIds = computed<string[]>(() => props.attachments?.[SSH_CONNECTION_ATTACHMENT_TYPE] ?? []);
/** 已绑定连接的展示信息（连接已被删除时标记 missing：chip 显示"未知连接"，原始 ID 仅留信息卡辨认） */
const attachedConnections = computed<AttachableConnection[]>(() =>
  attachedIds.value.map((id) => availableConnections.value.find((c) => c.id === id) ?? { id, name: id, missing: true }),
);

async function loadWorkspacePath(): Promise<void> {
  if (!props.sessionId) {
    mainWorkspacePath.value = "";
    return;
  }
  try {
    const res = await apiService.getWorkspacePath(props.sessionId);
    mainWorkspacePath.value = res.workspacePath || "";
  } catch {
    mainWorkspacePath.value = "";
  }
}

/** 解绑附加目录（主目录不可删；后端下回合 diff 后注入解绑提醒） */
function removeAttached(connectionId: string): void {
  writeAttachments(toggleConnectionBinding(props.attachments, connectionId));
}

/** 下拉 toggle 绑定（经共享纯函数翻转后上行；父层写 session.settings 后防抖持久化） */
function handleAttachedToggle(connectionId: string): void {
  writeAttachments(toggleConnectionBinding(props.attachments, connectionId));
}

/** 写回附件绑定并上行（完整 attachments 对象，父层写 session.settings 后防抖持久化） */
function writeAttachments(attachments: Record<string, string[]>): void {
  emit("attachmentsChange", attachments);
}

// ── 附加目录信息卡（点击 chip 弹出，非模态）──
const connCardVisible = ref(false);
const connCardAnchor = ref<HTMLElement | null>(null);
const activeConn = ref<AttachableConnection | null>(null);

function openConnCard(conn: AttachableConnection, e: MouseEvent): void {
  if (connCardVisible.value && activeConn.value?.id === conn.id) {
    connCardVisible.value = false;
    activeConn.value = null;
    return;
  }
  connCardAnchor.value = e.currentTarget as HTMLElement;
  activeConn.value = conn;
  connCardVisible.value = true;
}

function onConnCardShowChange(val: boolean): void {
  if (!val) {
    connCardVisible.value = false;
    activeConn.value = null;
  }
}

function handleUnbind(): void {
  if (activeConn.value) removeAttached(activeConn.value.id);
  connCardVisible.value = false;
  activeConn.value = null;
}

function permLabel(perm?: string): string {
  if (perm === "readonly") return t("chat.workspace.permReadonly");
  if (perm === "unrestricted") return t("chat.workspace.permUnrestricted");
  return t("chat.workspace.permWorkspace");
}

// 外部解绑/切换会话导致当前卡片的连接不再绑定 → 收卡
watch(attachedIds, (ids) => {
  if (activeConn.value && !ids.includes(activeConn.value.id)) {
    connCardVisible.value = false;
    activeConn.value = null;
  }
});

function openWorkspaceTree(): void {
  layoutStore.setWorkspaceVisible(true);
  // 文件标签激活中→保持；否则选标签栏末个文件标签；无→新建空浏览标签（目录树随之显示）
  nextTick(() => {
    tabStore.openWorkspaceBrowseTab(t('chat.workspace.newTab'));
    // 点目录名是显式浏览意图：强制展开目标标签的目录树（覆盖该标签此前的收起状态；
    // 新建空白标签本就默认展开，此处只对"选中已有文件标签"的情况生效）
    tabStore.setActiveFileTabTreeVisible(true);
  });
}

watch(
  () => props.sessionId,
  () => {
    void loadWorkspacePath();
  },
  { immediate: true },
);

onMounted(() => {
  void remoteWorkspaceStore.ensureConnections().finally(() => {
    connectionsLoading.value = false;
  });
});
</script>

<style scoped>
.working-dir-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0;
}

.wdb-main {
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: 60%;
  height: 24px;
  padding: 0 7px 0 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text-gray);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.wdb-main:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

.wdb-icon {
  color: var(--gd-color-text-gray);
  flex-shrink: 0;
}

.wdb-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wdb-attach {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  background: var(--gd-color-surface);
  color: var(--gd-color-text-gray);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.wdb-attach:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

/* 连接清单加载中的骨架占位：固定宽度微光扫过，替代闪原始连接 ID */
.wdb-attach-skeleton {
  width: 76px;
  cursor: default;
  background: linear-gradient(90deg,
      var(--gd-color-sidebar-bg-hover) 25%,
      var(--gd-color-surface-border) 50%,
      var(--gd-color-sidebar-bg-hover) 75%);
  background-size: 200% 100%;
  animation: wdb-skeleton-sweep 1.2s ease infinite;
}
@keyframes wdb-skeleton-sweep {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 附加目录信息卡：内边距由实例 wrapper 提供，不动 GdPopover */
.wdb-card {
  padding: 8px 10px;
}
.wdb-card-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  font-size: 12px;
}
.wdb-card-label {
  flex-shrink: 0;
  color: var(--gd-color-text-gray);
}
.wdb-card-value {
  flex: 1;
  min-width: 0;
  color: var(--gd-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wdb-card-unbind {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 5px 0;
  border: none;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.wdb-card-unbind:hover {
  background: rgba(239, 68, 68, 0.16);
}

.wdb-add {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--gd-color-text-gray);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.wdb-add:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
}

/* 下拉菜单容器：宽度下限 */
.wdb-menu {
  min-width: 160px;
}
</style>
