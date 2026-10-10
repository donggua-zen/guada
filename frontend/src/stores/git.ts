// stores/git.ts
import { getErrorMessage } from '@/utils/errorMessage'
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
  /**
   * 正在刷新的会话 id（null = 空闲）。用会话而非布尔去重：
   * 会话切换时上一个会话的 refresh 可能还在飞，若用布尔锁会把它当成"已在刷新"而跳过
   * 新会话的刷新（新会话的状态会一直空着/或被旧会话响应覆盖）。
   */
  let refreshingSid: string | null = null;
  const committing = ref(false);
  /** 当前进行中的提交/推送动作（供按钮显示进行中 ICON；null = 空闲） */
  const commitAction = ref<"commit" | "commitAndPush" | "push" | null>(null);
  /** 是否正在生成提交信息（LLM 调用中） */
  const generatingMessage = ref(false);

  // ── 提交弹窗状态（GitCommitDialog / GitChangesPanel / OverviewPanel 共用） ──
  const commitDialogVisible = ref(false);
  const commitMessage = ref("");
  const commitIncludeUnstaged = ref(true);

  // ── 项目提交约束（.guada/git/commit_constraint.md） ──
  const constraintDialogVisible = ref(false);
  const constraintContent = ref("");
  const constraintSaving = ref(false);

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
    // 会话可能在 await 期间被切走：把发起时的 sessionId 固定下来，后续请求与写回都用它，
    // 写回前再校验 store 仍停在同一会话。否则上一个会话（如 git 仓库）的 status 会覆盖
    // 新会话（如「公共目录」非仓库）—— 表现为侧边栏停留在上一个工作区的变更列表，
    // 且 isGitRepo 仍为 true → 面板继续对非仓库工作区请求 git/diff → 400「Not a git repository」。
    const sid = sessionId.value;
    if (!sid || refreshingSid === sid) return; // 同一会话已在刷新：去重
    refreshingSid = sid;
    refreshing.value = true;
    try {
      const res = await apiService.getGitStatus(sid);
      if (sessionId.value !== sid) return; // 已切走：丢弃过期结果
      status.value = res;
      if (res.branch) selectedBranch.value = res.branch;
      if (res.isGitRepo) {
        const b = await apiService.getGitBranches(sid);
        if (sessionId.value !== sid) return; // 同上：branches 不得写到新会话
        branches.value = b.branches;
      } else {
        branches.value = [];
      }
    } catch {
      if (sessionId.value !== sid) return; // 切走后的失败不属于当前会话，不弹提示
      status.value = null;
      ElMessage.error(t("git.loadFailed"));
    } finally {
      if (refreshingSid === sid) {
        refreshingSid = null;
        refreshing.value = false;
      }
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
    } catch (e) {
      ElMessage.error(t("git.checkoutFailed", { msg: getErrorMessage(e) || "" }));
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
    commitAction.value = push ? "commitAndPush" : "commit";
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
    } catch (e) {
      ElMessage.error(t(push ? "git.pushFailed" : "git.commitFailed", { msg: getErrorMessage(e) || "" }));
      await refresh();
    } finally {
      committing.value = false;
      commitAction.value = null;
    }
  }

  async function handlePush(): Promise<void> {
    if (!sessionId.value || committing.value) return;
    markGitWrite();
    committing.value = true;
    commitAction.value = "push";
    try {
      await apiService.gitPush(sessionId.value);
      ElMessage.success(t("git.pushSuccess"));
      commitDialogVisible.value = false;
      await refresh();
    } catch (e) {
      ElMessage.error(t("git.pushFailed", { msg: getErrorMessage(e) || "" }));
    } finally {
      committing.value = false;
    }
  }

  /** 当前生成请求的取消控制器（点击生成按钮时若正在生成则调用 cancel） */
  let generateAbortController: AbortController | null = null;

  /**
   * 调用 LLM 根据当前变更流式生成提交信息，实时填入提交信息输入框
   * 模型选择在后端完成：优先标题总结模型，无则回退当前对话模型
   */
  async function generateCommitMessage(): Promise<void> {
    if (!sessionId.value || generatingMessage.value) return;
    if (!status.value?.isGitRepo) {
      ElMessage.warning(t("git.notGitRepo"));
      return;
    }
    generatingMessage.value = true;
    // 生成前清空旧内容，开始流式累积
    commitMessage.value = "";
    generateAbortController = new AbortController();
    try {
      await apiService.generateCommitMessage(
        sessionId.value,
        commitIncludeUnstaged.value,
        (text) => {
          commitMessage.value += text;
        },
        generateAbortController.signal,
      );
      ElMessage.success(t("git.generateMessageSuccess"));
    } catch (e) {
      // 用户主动取消：保留已生成内容，不报错
      if ((e instanceof Error && e.name === "AbortError") || generateAbortController?.signal.aborted) {
        ElMessage.info(t("git.generateMessageCancelled"));
        return;
      }
      // skipped 事件：错误 message 即 reason 键（如 no_model_configured）
      const reason = getErrorMessage(e);
      const knownReasons = [
        "empty_diff",
        "no_model_configured",
        "model_not_found",
        "generation_failed",
        "aborted",
        "error",
      ] as const;
      if ((knownReasons as readonly string[]).includes(reason)) {
        ElMessage.warning(
          t("git.generateMessageFailed", {
            // includes 判定后 reason 必为已知键之一，收窄以满足 i18n 键类型
            reason: t(`git.generateReason.${reason as (typeof knownReasons)[number]}`),
          }),
        );
      } else {
        ElMessage.error(
          t("git.generateMessageError", { msg: reason }),
        );
      }
    } finally {
      generatingMessage.value = false;
      generateAbortController = null;
    }
  }

  /** 取消当前生成（生成中点击按钮触发） */
  function cancelGenerateMessage(): void {
    generateAbortController?.abort();
  }

  // ── 项目提交约束管理 ──

  /** 打开约束编辑对话框并加载当前内容 */
  async function openConstraintDialog(): Promise<void> {
    constraintDialogVisible.value = true;
    if (!sessionId.value) return;
    try {
      const res = await apiService.getCommitConstraint(sessionId.value);
      constraintContent.value = res.content || "";
    } catch (e) {
      constraintContent.value = "";
      ElMessage.error(t("git.constraintLoadFailed", { msg: getErrorMessage(e) || "" }));
    }
  }

  /** 保存约束内容到 .guada/git/commit_constraint.md */
  async function saveConstraint(): Promise<void> {
    if (!sessionId.value || constraintSaving.value) return;
    constraintSaving.value = true;
    try {
      await apiService.saveCommitConstraint(
        sessionId.value,
        constraintContent.value,
      );
      constraintDialogVisible.value = false;
      ElMessage.success(t("git.constraintSaveSuccess"));
    } catch (e) {
      ElMessage.error(t("git.constraintSaveFailed", { msg: getErrorMessage(e) || "" }));
    } finally {
      constraintSaving.value = false;
    }
  }

  return {
    sessionId,
    status,
    branches,
    selectedBranch,
    refreshing,
    committing,
    commitAction,
    generatingMessage,
    commitDialogVisible,
    commitMessage,
    commitIncludeUnstaged,
    constraintDialogVisible,
    constraintContent,
    constraintSaving,
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
    generateCommitMessage,
    cancelGenerateMessage,
    openConstraintDialog,
    saveConstraint,
  };
});
