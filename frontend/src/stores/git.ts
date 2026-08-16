// stores/git.ts
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { apiService } from "@/services/ApiService";
import type { GitStatus, GitBranch } from "@/services/modules/git.api";
import type { FileChangeEvent } from "@/services/modules/WorkspaceWatcherService";
import { t } from "@/locales";

/**
 * Git 全局 Store —— 工作区概览（OverviewPanel）与 Git 变更面板（GitChangesPanel）
 * 共享的数据源：status / branches / 增删统计 / 提交弹窗状态 / 自动刷新。
 *
 * 概览面板常驻于聊天右侧（工作区可隐藏），因此 status 的获取与「外部 git 操作自动刷新」
 * 必须由本 store 承担（不依赖 GitChangesPanel 是否挂载）。
 */

export interface GitDiffStats {
  add: number;
  del: number;
}

export const useGitStore = defineStore("git", () => {
  const sessionId = ref<string | null>(null);
  const status = ref<GitStatus | null>(null);
  const branches = ref<GitBranch[]>([]);
  const selectedBranch = ref("");
  const refreshing = ref(false);
  const committing = ref(false);

  // ── 提交弹窗状态（GitCommitDialog / GitChangesPanel / OverviewPanel 共用） ──
  const commitDialogVisible = ref(false);
  const commitMessage = ref("");
  const commitIncludeUnstaged = ref(true);

  // ── 派生统计 ──
  const isGitRepo = computed(() => status.value?.isGitRepo ?? false);
  const totalChanges = computed(() => status.value?.files.length ?? 0);

  /** 全量变更统计：所有变更文件增删行数之和（HEAD vs 工作区，含未跟踪） */
  const totalStats = computed<GitDiffStats>(() => {
    let add = 0;
    let del = 0;
    for (const f of status.value?.files || []) {
      add += f.additions || 0;
      del += f.deletions || 0;
    }
    return { add, del };
  });

  /** 仅暂存统计（HEAD vs 暂存区）——提交弹窗未勾选「包含未暂存」时的提交量 */
  const stagedStats = computed<GitDiffStats>(() => ({
    add: status.value?.stagedAdditions ?? 0,
    del: status.value?.stagedDeletions ?? 0,
  }));

  /** 提交弹窗统计：随「包含未暂存」勾选切换（勾选 = 全部变更，否则 = 仅已暂存） */
  const commitStats = computed<GitDiffStats>(() =>
    commitIncludeUnstaged.value ? totalStats.value : stagedStats.value,
  );

  /** 每次刷新完成自增（组件据此做选中恢复等后处理） */
  let refreshSeq = 0;

  /**
   * 会话绑定（幂等）：切换会话 → 重置并刷新。概览与面板均可调用。
   * 同时订阅 git 事件范围（消费方订阅）：SSE 连接由 MainLayout 持有，
   * 这里按会话订阅/退订 git scope —— 后端据此激活 .git watcher。
   */
  function bindSession(id: string | null): void {
    const oldId = sessionId.value;
    if (oldId === id) return;
    sessionId.value = id;
    // git 事件消费方订阅：会话切换时更新（旧会话退订、新会话订阅）
    if (oldId) void apiService.setWorkspaceWatchScope(oldId, "git", false);
    if (id) void apiService.setWorkspaceWatchScope(id, "git", true);
    status.value = null;
    branches.value = [];
    selectedBranch.value = "";
    commitMessage.value = "";
    commitDialogVisible.value = false;
    if (id) void refresh();
  }

  async function refresh(): Promise<void> {
    if (!sessionId.value || refreshing.value) return;
    refreshing.value = true;
    try {
      const res = await apiService.getGitStatus(sessionId.value);
      status.value = res;
      if (res.branch) selectedBranch.value = res.branch;
      if (res.isGitRepo) {
        const b = await apiService.getGitBranches(sessionId.value);
        branches.value = b.branches;
      } else {
        branches.value = [];
      }
    } catch {
      status.value = null;
      ElMessage.error(t("git.loadFailed"));
    } finally {
      refreshing.value = false;
      refreshSeq++;
    }
  }

  // ── 外部 git 操作自动刷新（后端 .git watcher 推送 type:"git"） ──
  // 自身 commit/stage 等写操作也会触发事件，OWN_GIT_WRITE_SUPPRESS_MS 内抑制，
  // 避免刚操作完立刻被事件再刷一次。
  let gitRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let lastOwnGitWrite = 0;
  const OWN_GIT_WRITE_SUPPRESS_MS = 1000;

  function markGitWrite(): void {
    lastOwnGitWrite = Date.now();
  }

  function onWorkspaceGitEvent(event: FileChangeEvent): void {
    if (event.type !== "git") return;
    if (event.sessionId && event.sessionId !== sessionId.value) return;
    if (Date.now() - lastOwnGitWrite < OWN_GIT_WRITE_SUPPRESS_MS) return;
    if (gitRefreshTimer) clearTimeout(gitRefreshTimer);
    gitRefreshTimer = setTimeout(() => {
      gitRefreshTimer = null;
      void refresh();
    }, 200);
  }

  // store 单例：订阅一次（概览/面板任一启用即生效，生命周期随应用）
  const unsubscribeGitEvent = apiService.onWorkspaceChange(onWorkspaceGitEvent);

  /** 切换分支 */
  async function checkout(branch: string): Promise<void> {
    if (!sessionId.value || !branch) return;
    markGitWrite();
    try {
      await apiService.gitCheckout(sessionId.value, branch);
      ElMessage.success(t("git.checkoutSuccess", { branch }));
      selectedBranch.value = branch;
      await refresh();
    } catch (e: any) {
      ElMessage.error(t("git.checkoutFailed", { msg: e?.message || "" }));
    }
  }

  // ── 提交 / 推送（提交弹窗共用） ──

  function openCommitDialog(): void {
    commitDialogVisible.value = true;
  }

  async function submitCommit(push: boolean): Promise<void> {
    const message = commitMessage.value.trim();
    if (!message) {
      ElMessage.warning(t("git.commitMessageEmpty"));
      return;
    }
    if (!sessionId.value || committing.value) return;
    markGitWrite();
    committing.value = true;
    try {
      // 勾选「包含未暂存的更改」→ 先全部暂存再提交（VS Code「全部提交」语义）
      if (commitIncludeUnstaged.value) {
        await apiService.gitStage(sessionId.value);
      }
      await apiService.gitCommit(sessionId.value, message);
      if (push) await apiService.gitPush(sessionId.value);
      ElMessage.success(t(push ? "git.commitPushSuccess" : "git.commitSuccess"));
      commitMessage.value = "";
      commitDialogVisible.value = false;
      await refresh();
    } catch (e: any) {
      ElMessage.error(t(push ? "git.pushFailed" : "git.commitFailed", { msg: e?.message || "" }));
      await refresh();
    } finally {
      committing.value = false;
    }
  }

  async function handlePush(): Promise<void> {
    if (!sessionId.value || committing.value) return;
    markGitWrite();
    committing.value = true;
    try {
      await apiService.gitPush(sessionId.value);
      ElMessage.success(t("git.pushSuccess"));
      commitDialogVisible.value = false;
      await refresh();
    } catch (e: any) {
      ElMessage.error(t("git.pushFailed", { msg: e?.message || "" }));
    } finally {
      committing.value = false;
    }
  }

  return {
    sessionId,
    status,
    branches,
    selectedBranch,
    refreshing,
    committing,
    commitDialogVisible,
    commitMessage,
    commitIncludeUnstaged,
    isGitRepo,
    totalChanges,
    totalStats,
    stagedStats,
    commitStats,
    refreshSeq,
    unsubscribeGitEvent,
    bindSession,
    refresh,
    markGitWrite,
    checkout,
    openCommitDialog,
    submitCommit,
    handlePush,
  };
});
