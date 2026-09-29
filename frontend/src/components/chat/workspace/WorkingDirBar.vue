<template>
  <!-- 紧凑单行（输入框底部外侧）：主目录（点击打开目录树）+ 附加远程目录 chips + 添加绑定 -->
  <div class="working-dir-bar">
    <button class="wdb-main" :title="mainWorkspacePath || t('chat.workspace.workingDir')"
      @click="openWorkspaceTree">
      <el-icon :size="16" class="wdb-icon"><Folder16Regular /></el-icon>
      <span class="wdb-name">{{ mainWorkspaceBasename || t('chat.workspace.workingDir') }}</span>
    </button>

    <!-- 附加目录：已绑定的远程连接；hover 显示解除按钮 -->
    <template v-for="conn in attachedConnections" :key="conn.id">
      <GdTooltip :content="chipTooltip(conn)" placement="bottom">
        <span class="wdb-attach">
          <el-icon :size="16" class="wdb-icon"><Cloud16Regular /></el-icon>
          <span class="wdb-name">{{ conn.name }}</span>
          <GdTooltip :content="t('chat.workspace.removeAttachedDir')" placement="bottom">
            <button class="wdb-remove" @click.stop="removeAttached(conn.id)">
              <el-icon :size="9"><Close /></el-icon>
            </button>
          </GdTooltip>
        </span>
      </GdTooltip>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { Close } from "@element-plus/icons-vue";
import { Folder16Regular, Cloud16Regular, Add16Regular } from "@vicons/fluent";
import DropdownMenu from "../../ui/DropdownMenu.vue";
import GdTooltip from "../../ui/GdTooltip.vue";
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

interface AttachableConnection { id: string; name: string; description?: string; path?: string; }
const remoteWorkspaceStore = useRemoteWorkspaceStore();
/** remote-workspace 全部连接（store 共享清单，设置页新建后此处自动可见） */
const availableConnections = computed(() => remoteWorkspaceStore.connectionOptions);

/** 当前会话已绑定的附加目录 ID（props.attachments 单向下传，增删经 attachmentsChange 上行） */
const attachedIds = computed<string[]>(() => props.attachments?.[SSH_CONNECTION_ATTACHMENT_TYPE] ?? []);
/** 已绑定连接的展示信息（连接清单缺失时回退显示 ID） */
const attachedConnections = computed<AttachableConnection[]>(() =>
  attachedIds.value.map((id) => availableConnections.value.find((c) => c.id === id) ?? { id, name: id }),
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

/** chips 悬浮提示：user@host · 远端工作目录（tooltip 为单行文本渲染，不支持换行） */
function chipTooltip(conn: AttachableConnection): string {
  if (!conn.description) return conn.name;
  return conn.path ? `${conn.description} · ${conn.path}` : conn.description;
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
  void remoteWorkspaceStore.ensureConnections();
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
}
.wdb-attach:hover {
  color: var(--gd-color-text);
}
.wdb-attach .wdb-remove {
  display: none;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--gd-color-text-gray);
  cursor: pointer;
}
.wdb-attach:hover .wdb-remove {
  display: flex;
}
.wdb-attach .wdb-remove:hover {
  background: var(--gd-color-sidebar-bg-hover);
  color: var(--gd-color-text);
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
