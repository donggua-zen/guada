<template>
  <div class="git-changes-panel h-full flex flex-col min-h-0">
    <!-- 顶部工具栏（单行紧凑）：分支 chip | 全量变更统计 | 领先/落后 | 刷新 | 视图切换 | 目录树开关 | 提交（弹窗） -->
    <div class="shrink-0 git-toolbar">
      <!-- 分支：简洁 chip + 自定义下拉（替代 el-select 原生样式） -->
      <DropdownMenu @command="git.checkout">
        <button class="git-branch-chip" :disabled="!isGitRepo || refreshing">
          <!-- Branch20Regular 为 20 viewBox：16px 仍非整数缩放，但 0.8 倍较柔和；
               图标优先选原生尺寸更锐利 -->
          <el-icon :size="16"><Branch20Regular /></el-icon>
          <span class="git-branch-chip-name">{{ selectedBranch || t('git.branchSelectPlaceholder') }}</span>
          <el-icon :size="10" class="git-branch-chip-chevron"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <div class="git-branch-menu">
            <DropdownMenuItem v-for="b in branches" :key="b.name" :command="b.name">
              <span class="git-branch-menu-item">
                <span class="git-branch-menu-check">{{ b.current ? '✓' : '' }}</span>
                <span class="git-branch-menu-name">{{ b.name }}</span>
              </span>
            </DropdownMenuItem>
          </div>
        </template>
      </DropdownMenu>
      <!-- 全量变更统计：所有变更文件增删行数之和 -->
      <span v-if="isGitRepo && (totalStats.add || totalStats.del)" class="git-diff-stats git-toolbar-stats">
        <span v-if="totalStats.add" class="git-stat-add">+{{ totalStats.add }}</span>
        <span v-if="totalStats.del" class="git-stat-del">-{{ totalStats.del }}</span>
      </span>
      <span v-if="isGitRepo && (status?.ahead || status?.behind)" class="git-toolbar-ab"
        :title="t('git.aheadBehind', { ahead: status?.ahead, behind: status?.behind })">
        ↑{{ status?.ahead || 0 }} ↓{{ status?.behind || 0 }}
      </span>
      <div class="flex-1"></div>
      <LTooltip :content="t('git.refresh')" placement="bottom">
        <button class="git-tool-btn" :disabled="!isGitRepo || refreshing" @click="refresh">
          <!-- Refresh 为 16 viewBox：按原生尺寸渲染，避免非整数缩放发虚 -->
          <el-icon :size="16" :class="{ 'is-loading': refreshing }">
            <Refresh />
          </el-icon>
        </button>
      </LTooltip>
      <!-- 视图切换（unified/split）：单按钮，图标随当前状态切换（显示目标视图图标）：
           分栏视图下显示统一视图图标（CalendarAgenda），统一视图下显示分栏图标（DualScreen） -->
      <LTooltip :content="diffView === 'unified' ? t('git.splitView') : t('git.unifiedView')" placement="bottom">
        <button class="git-tool-btn" @click="toggleDiffView">
          <!-- 20 viewBox：原生尺寸 20px，保证像素对齐锐利 -->
          <el-icon :size="20">
            <CalendarAgenda20Regular v-if="diffView === 'split'" />
            <DualScreen20Regular v-else />
          </el-icon>
        </button>
      </LTooltip>
      <!-- 右侧变更目录树开关 -->
      <LTooltip :content="t('git.toggleTree')" placement="bottom">
        <button class="git-tool-btn" :class="{ 'git-tool-btn--active': showTree }"
          @click="showTree = !showTree">
          <el-icon :size="20"><TextboxAlignTopRotate9020Regular /></el-icon>
        </button>
      </LTooltip>
      <!-- 提交（弹窗：消息 + 是否包含未暂存 + 提交/提交并推送/推送）：胶囊按钮 -->
      <button class="git-commit-btn" :disabled="!isGitRepo || totalChanges === 0"
        @click="git.openCommitDialog()">
        <el-icon :size="16"><BranchFork16Regular /></el-icon>
        <span>{{ t('git.commitOrPush') }}</span>
      </button>
    </div>

    <!-- 左：选中文件 diff 预览（弹性，窗口缩小时优先被压缩）| 右：变更文件目录树
         （固定像素宽，LiteSplitpanes 拖拽分割；优先压缩的仍是 diff 预览，规则不变） -->
    <div ref="bodyRef" class="git-body flex-1 min-h-0">
      <LiteSplitpanes
        :split-size="diffSplitPct"
        :min-size="diffMinPct"
        :max-size="100"
        :min-pane2-size="MIN_TREE_WIDTH"
        @resized="onTreeSplitResized"
      >
        <template #pane1>
          <!-- 左侧 diff 预览：两种视图都走「header 固定 + 自绘竖向滚动条 + 行虚拟化」
               （pane 不滚动；横向原生滚动在各自列容器内） —— 滚动逻辑完全共用一套 -->
          <div class="git-diff-pane git-diff-pane--split">
        <template v-if="selectedRow">
          <div class="git-diff-header">
            <span class="git-status" :class="`git-status--${statusClass(selectedRow)}`">{{ selectedRow.statusChar }}</span>
            <span class="git-diff-header-path" :title="selectedRow.file.path">{{ selectedRow.file.path }}</span>
            <span v-if="selectedStats && (selectedStats.add || selectedStats.del)" class="git-diff-stats">
              <span v-if="selectedStats.add" class="git-stat-add">+{{ selectedStats.add }}</span>
              <span v-if="selectedStats.del" class="git-stat-del">-{{ selectedStats.del }}</span>
            </span>
            <button class="git-diff-close" :title="t('git.closePreview')" @click="clearSelection">
              <el-icon :size="12"><Close /></el-icon>
            </button>
          </div>
          <div v-if="loadingKey === selectedKey" class="git-diff-loading">
            {{ t('git.loading') }}
          </div>
          <!-- 拆分视图：左右两列（旧文件 | 新文件）各为整体滚动容器（整列只有一个横向滚动条，
               内容超长只在所在列内滚动，不互相顶开；横向 scrollLeft 两列同步）；
               行号都钉各自列左缘（VS Code 风格）。
               ctx 行两列相同、add 只新列、del 只旧列；gap 行左右各显示一个跳过行数提示条 -->
          <div v-else-if="diffView === 'split'" class="git-diff-split">
            <!-- binary 文件：整份只有一行提示，全宽显示（无需双列） -->
            <GitDiffRow v-if="isBinarySplit" :line="binaryLine" side="uni" :top="0" />
            <!-- 两列容器可聚焦：点击 diff 区域即聚焦，方向键/翻页/Home/End 滚动（对齐原生） -->
            <div v-else class="git-diff-split-cols" tabindex="0"
              :class="{ focused: vScroll.focused }"
              @focus="vScroll.focused = true" @blur="vScroll.focused = false"
              @keydown="onVScrollKeydown">
              <!-- 旧文件列（横向原生滚动；纵向由 inner translateY + 统一滚动条控制；
                   行虚拟化：只渲染可视行，按固定行高绝对定位） -->
              <div ref="oldColRef" class="git-diff-split-col git-diff-split-col--old"
                @wheel.prevent="onColWheel" @scroll.passive="onColScroll($event, 'old')">
                <div ref="oldColInnerRef" class="git-diff-split-col-inner"
                  :style="{ height: rowMetrics.total + 'px' }">
                  <!-- 宽度锚层：正常流渲染所有行内容宽度（max-content），撑宽 inner →
                       行宽 = inner 宽 = max(内容宽, 100%) → 行背景铺满整行（横向滚动右侧不丢背景）。
                       测量本列（old 侧）自身内容；锚层行的 padding 补齐行号+内容 padding 的
                       68px 水平 chrome（见 .git-diff-size-line），否则最宽实际行会超出 inner
                       → 滚动区右端多出一段短行背景盖不到的区域 -->
                  <div class="git-diff-split-col-size" aria-hidden="true">
                    <span v-for="(line, si) in displaySplitLines" :key="si" class="git-diff-size-line"
                      v-html="sizeLineHtml(line, 'old')"></span>
                  </div>
                  <!-- 行渲染统一由 GitDiffRow 承担（unified/split 两列共用；
                       gap 折叠条可点击展开，三视图行为一致） -->
                  <GitDiffRow v-for="item in splitSlice" :key="item.idx"
                    :line="item.line" side="old" :top="rowMetrics.tops[item.idx]" @toggle="toggleGap" />
                </div>
              </div>
              <div class="git-diff-split-col-divider"></div>
              <!-- 新文件列（横向原生滚动；纵向由 translateY + JS 统一控制；行虚拟化） -->
              <div ref="newColRef" class="git-diff-split-col git-diff-split-col--new"
                @wheel.prevent="onColWheel" @scroll.passive="onColScroll($event, 'new')">
                <div ref="newColInnerRef" class="git-diff-split-col-inner"
                  :style="{ height: rowMetrics.total + 'px' }">
                  <!-- 宽度锚层（同左列，测量本列 new 侧内容）：撑宽 inner → 行背景铺满整行 -->
                  <div class="git-diff-split-col-size" aria-hidden="true">
                    <span v-for="(line, si) in displaySplitLines" :key="si" class="git-diff-size-line"
                      v-html="sizeLineHtml(line, 'new')"></span>
                  </div>
                  <GitDiffRow v-for="item in splitSlice" :key="item.idx"
                    :line="item.line" side="new" :top="rowMetrics.tops[item.idx]" @toggle="toggleGap" />
                </div>
              </div>
              <!-- 统一竖向滚动条：两列原生竖条隐藏，纵向由 JS 统一控制（永远同步）。
                   拖拽中加全屏遮罩（其他元素不响应，原生滚动条行为）。
                   tabindex=0 使其可聚焦，聚焦时支持方向键/翻页/Home/End（对齐原生滚动条键盘） -->
              <div ref="vScrollTrackRef" class="git-diff-vscroll" v-show="vScroll.visible"
                tabindex="0" :class="{ focused: vScroll.focused }"
                @mousedown.prevent="onVScrollTrackDown"
                @focus="vScroll.focused = true" @blur="vScroll.focused = false"
                @keydown="onVScrollKeydown">
                <div ref="vScrollThumbRef" class="git-diff-vscroll-thumb"
                  :class="{ dragging: vScroll.dragging }"
                  :style="{ top: vScroll.thumbTop + 'px', height: vScroll.thumbHeight + 'px' }"
                  @mousedown.stop="onThumbDown"></div>
              </div>
            </div>
            <!-- 拖拽遮罩：Teleport 必须在 v-if/v-else-if/v-else 链内（split 分支），
                 否则打断链导致 v-else 报"无相邻 v-if" -->
            <Teleport to="body">
              <div v-if="vScroll.dragging" class="git-diff-vscroll-mask"></div>
            </Teleport>
          </div>
          <!-- 统一视图：单列（行号 + 内容）。数据管线（displaySplitLines → displayUnifiedLines）
               与行渲染（GitDiffRow）与 split 共用；滚动结构与 split 列同构 ——
               横向原生滚动、纵向 translateY + 自绘滚动条、行虚拟化全部复用同一套机制，
               不再维护独立的原生滚动状态 -->
          <div v-else class="git-diff-split">
            <!-- binary 文件：整份只有一行提示，全宽显示（无需滚动） -->
            <GitDiffRow v-if="isBinarySplit" :line="binaryLine" side="uni" :top="0" />
            <!-- 单列容器可聚焦：方向键/翻页/Home/End 滚动（与 split 一致） -->
            <div v-else class="git-diff-split-cols" tabindex="0"
              :class="{ focused: vScroll.focused }"
              @focus="vScroll.focused = true" @blur="vScroll.focused = false"
              @keydown="onVScrollKeydown">
              <div ref="uniColRef" class="git-diff-split-col git-diff-split-col--uni"
                @wheel.prevent="onColWheel" @scroll.passive="onColScroll($event, 'uni')">
                <div ref="uniColInnerRef" class="git-diff-split-col-inner"
                  :style="{ height: uniMetrics.total + 'px' }">
                  <!-- 宽度锚层（同 split 列）：撑宽列 → 行背景铺满整行（横向滚动右侧不丢背景） -->
                  <div class="git-diff-split-col-size" aria-hidden="true">
                    <span v-for="(line, si) in displayUnifiedLines" :key="si" class="git-diff-size-line"
                      v-html="sizeLineHtml(line, 'uni')"></span>
                  </div>
                  <GitDiffRow v-for="item in uniSlice" :key="item.idx"
                    :line="item.line" side="uni" :top="uniMetrics.tops[item.idx]" @toggle="toggleGap" />
                </div>
              </div>
              <!-- 统一竖向滚动条（与 split 共用同一套拖拽/点轨道/键盘逻辑） -->
              <div ref="vScrollTrackRef" class="git-diff-vscroll" v-show="vScroll.visible"
                tabindex="0" :class="{ focused: vScroll.focused }"
                @mousedown.prevent="onVScrollTrackDown"
                @focus="vScroll.focused = true" @blur="vScroll.focused = false"
                @keydown="onVScrollKeydown">
                <div ref="vScrollThumbRef" class="git-diff-vscroll-thumb"
                  :class="{ dragging: vScroll.dragging }"
                  :style="{ top: vScroll.thumbTop + 'px', height: vScroll.thumbHeight + 'px' }"
                  @mousedown.stop="onThumbDown"></div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="git-diff-empty">
          {{ isGitRepo ? (totalChanges === 0 ? t('git.noChanges') : t('git.selectFileToPreview')) : t('git.notGitRepo') }}
        </div>
          </div>
        </template>

        <template #pane2>
          <!-- 右侧变更文件目录树 -->
          <div class="git-tree-pane">
            <!-- 搜索框：固定在顶部，不随列表滚动 -->
            <div class="git-tree-search shrink-0">
              <el-icon :size="14" class="git-tree-search-icon">
                <Search20Regular />
              </el-icon>
              <input
                v-model="searchText"
                class="git-tree-search-input"
                type="text"
                spellcheck="false"
                :placeholder="t('git.searchFiles')"
              />
              <button v-if="searchText" class="git-tree-search-clear" @click="searchText = ''">
                <el-icon :size="12"><Close /></el-icon>
              </button>
            </div>
            <div ref="treeScrollRef" class="git-tree-scroll" tabindex="0"
              :class="{ focused: treeFocused }"
              @keydown="onTreeKeydown" @focus="treeFocused = true" @blur="treeFocused = false">
        <template v-if="isGitRepo">
          <div v-for="group in displayGroups" :key="group.key">
            <div class="git-group-header">
              {{ group.label }} ({{ group.rows.length }})
            </div>
            <div v-for="trow in group.treeRows" :key="trow.key" class="git-tree-row"
              :class="{
                'git-tree-row--dir': trow.isDir,
                'git-tree-row--partial': !trow.isDir && !!trow.row?.isPartial,
                'git-tree-row--active': treeFocused && activeTreeKey === trow.key,
                selected: !trow.isDir && selectedKey === trow.key,
              }"
              :ref="(el) => setTreeRowRef(trow.key, el)"
              :style="{ paddingLeft: 8 + trow.depth * 14 + 'px', '--indent': trow.depth * 14 + 'px' }"
              @click="onTreeRowClick(trow)">
              <template v-if="trow.isDir">
                <el-icon :size="12" class="git-tree-chevron"
                  :class="{ expanded: !collapsedDirs.has(trow.key) }">
                  <ArrowRight />
                </el-icon>
                <span class="git-tree-name" :title="trow.path">{{ trow.name }}</span>
                <!-- 文件夹级操作：暂存/取消暂存整个目录下的全部变更文件（hover 显示） -->
                <span class="git-row-actions" @click.stop>
                  <button v-if="(trow.stagedCount ?? 0) > 0" class="git-row-btn" :title="t('git.unstageAll')"
                    @click="unstageDir(group, trow)">
                    <el-icon :size="12"><Subtract16Regular /></el-icon>
                  </button>
                  <button v-if="(trow.unstagedCount ?? 0) > 0" class="git-row-btn" :title="t('git.stageAll')"
                    @click="stageDir(group, trow)">
                    <el-icon :size="12"><Add16Regular /></el-icon>
                  </button>
                </span>
              </template>
              <template v-else>
                <span class="git-status" :class="`git-status--${statusClass(trow.row!)}`">{{ trow.row!.statusChar }}</span>
                <span class="git-tree-name" :title="trow.row!.file.path">{{ trow.name }}</span>
                <span class="git-row-actions" @click.stop>
                  <button v-if="trow.row!.group === 'staged'" class="git-row-btn" :title="t('git.unstage')"
                    @click="unstageFile(trow.row!)">
                    <el-icon :size="12"><Subtract16Regular /></el-icon>
                  </button>
                  <button v-else class="git-row-btn" :title="t('git.stage')" @click="stageFile(trow.row!)">
                    <el-icon :size="12"><Add16Regular /></el-icon>
                  </button>
                </span>
              </template>
            </div>
          </div>
          <div v-if="!refreshing && totalChanges === 0" class="text-center py-8 text-gray-400 dark:text-[#6b6d73] text-xs">
            {{ t('git.noChanges') }}
          </div>
        </template>
        <div v-else class="text-center py-8 text-gray-400 dark:text-[#6b6d73] text-xs px-4">
          {{ t('git.notGitRepo') }}
        </div>
            </div>
          </div>
        </template>
      </LiteSplitpanes>
    </div>

    <!-- 提交弹窗已抽为全局组件 GitCommitDialog（数据走 GitStore），
         本面板顶部「提交或推送」按钮与概览面板共用同一入口 -->

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, reactive, onUnmounted } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useStorage } from "@vueuse/core";
import { Refresh, ArrowRight, ArrowDown, Close } from "@element-plus/icons-vue";
import { Branch20Regular, BranchFork16Regular, Search20Regular, Add16Regular, Subtract16Regular, CalendarAgenda20Regular, DualScreen20Regular, TextboxAlignTopRotate9020Regular } from "@vicons/fluent";
import { LiteSplitpanes } from "../../ui";
import DropdownMenu from "../../ui/DropdownMenu.vue";
import DropdownMenuItem from "../../ui/DropdownMenuItem.vue";
import LTooltip from "../../ui/LTooltip.vue";
import GitDiffRow from "./GitDiffRow.vue";
import { apiService } from "@/services/ApiService";
import type { GitFileChange, GitDiff } from "@/services/modules/git.api";
import type { DiffLine, SplitDiffLine, DisplaySplitLine } from "./git-diff-types";
import { useGitStore } from "@/stores/git";
import { useHighlight } from "@/composables/useHighlight";

const { t } = useI18n();
const { highlightCodeLines, getLanguageFromExtension, escapeHtml } = useHighlight();

const props = defineProps<{
  sessionId: string | null;
}>();

interface GitRow {
  file: GitFileChange;
  group: "staged" | "changes" | "conflicts";
  statusChar: string;
  isPartial: boolean;
}

interface GitGroup {
  key: string;
  label: string;
  rows: GitRow[];
  treeRows: GitTreeRow[];
}

/* DiffLine / SplitDiffLine / DisplaySplitLine 已抽到 ./git-diff-types.ts（与 GitDiffRow 共用） */

interface DiffStats {
  add: number;
  del: number;
}

/** diff 视图模式：unified（单列）| split（左右两列） */
type DiffViewMode = "unified" | "split";

/** 目录树的扁平行：目录（可折叠）与文件（可选中）统一渲染 */
interface GitTreeRow {
  key: string;
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  row?: GitRow;
  /** 目录行：子树中已暂存/未暂存文件数（+ / − 按钮显隐依据，文件行无此字段） */
  stagedCount?: number;
  unstagedCount?: number;
}

interface GitTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  row?: GitRow;
  children: GitTreeNode[];
  /** 子树（含叶子）已暂存/未暂存文件数，目录聚合 */
  stagedCount: number;
  unstagedCount: number;
}

/** 单文件 diff 行数上限，防止大文件拖垮渲染 */
const MAX_DIFF_LINES = 800;

/**
 * 全文模式：后端随 diff 附带两侧完整内容时，diff 只作对齐信息（行号/类型/gap 区间），
 * 行内容按行号从全文高亮数组取（全文一次高亮，跨行 token 上下文完整），
 * gap 展开也直接本地取行，无需再请求后端。
 */
interface FullHighlight {
  /** 旧侧全文逐行高亮（索引 = 旧行号 - 1） */
  oldHtml: string[];
  /** 新侧全文逐行高亮（索引 = 新行号 - 1） */
  newHtml: string[];
}

/**
 * GitStore 只读别名：status/branches/分支/刷新态/统计等已上收至 GitStore
 * （概览面板常驻共用），本面板只读消费；写入统一走 store（refresh/checkout/提交）。
 */
const git = useGitStore();
const status = computed(() => git.status);
const branches = computed(() => git.branches);
const selectedBranch = computed(() => git.selectedBranch);
const refreshing = computed(() => git.refreshing);
const isGitRepo = computed(() => git.isGitRepo);
const totalChanges = computed(() => git.totalChanges);
const totalStats = computed(() => git.totalStats);
/** 左侧当前选中文件（主从布局单选中） */
const selectedKey = ref<string | null>(null);
/** 正在加载的选中 key（单并发） */
const loadingKey = ref<string | null>(null);
/** 当前选中行的 diff 内容（瞬态显示状态）：切换选中即丢弃、重新选中必重新拉取，不缓存 */
const diffLines = ref<Record<string, DiffLine[]>>({});
/** diff 视图模式：unified（单列）| split（左右两列），持久化 */
const diffView = useStorage<DiffViewMode>('guada-git-diff-view', 'unified');
/** 用户手动折叠的目录 key 集合（默认全部展开，折叠为显式操作） */
const collapsedDirs = ref<Set<string>>(new Set());
/** diff 请求序号：选中切换/清空时自增，过期响应（在途旧请求）直接丢弃 */
let diffLoadSeq = 0;

/** 当前选中文件的全文高亮（全文模式；降级模式为 null）。随 loadDiff 覆盖，不缓存 */
const fullHighlight = ref<FullHighlight | null>(null);

/**
 * 目录宽度（右侧固定像素，LiteSplitpanes 拖拽调整，持久化到 localStorage）。
 * diff 预览在 pane1 弹性吃剩余空间，窗口缩放时优先压缩 diff（规则不变）：
 * 存储与拖拽结果均为像素，渲染时换算 pane1（diff）百分比喂给 LiteSplitpanes
 * （组件内部仍是百分比布局，换算保证 pane2 目录像素不变）。
 */
const MIN_TREE_WIDTH = 160;
/** diff 预览最小像素（弹性一侧的下限，避免窗口缩小时被压得过窄） */
const MIN_DIFF_WIDTH = 200;
const treePaneWidthPx = useStorage('guada-git-tree-width-px', 260);

/** 分割容器（.git-body）引用：ResizeObserver 跟踪宽度用于换算 */
const bodyRef = ref<HTMLElement | null>(null);
const containerWidth = ref(0);
let bodyResizeObserver: ResizeObserver | null = null;

watch(bodyRef, (el) => {
  bodyResizeObserver?.disconnect();
  bodyResizeObserver = null;
  if (!el) return;
  containerWidth.value = el.clientWidth;
  bodyResizeObserver = new ResizeObserver((entries) => {
    for (const e of entries) containerWidth.value = e.contentRect.width;
  });
  bodyResizeObserver.observe(el);
}, { flush: 'post' });

/**
 * pane1（diff 预览）百分比 = 100 - 目录宽百分比：
 * 目录固定像素宽（treePaneWidthPx），diff 弹性吃剩余空间，
 * 窗口缩放时优先压缩 diff 预览（规则不变）。
 * 目录树隐藏（showTree=false）时返回 100 → LiteSplitpanes 折叠 pane2（diff 占满）。
 */
const diffSplitPct = computed(() => {
  if (!showTree.value) return 100;
  const cw = containerWidth.value;
  if (cw <= 0) return 70;
  const available = cw - 1; // 分割条 1px
  const maxPx = Math.max(MIN_TREE_WIDTH, available - MIN_DIFF_WIDTH); // diff 最小 200px
  const px = Math.max(MIN_TREE_WIDTH, Math.min(treePaneWidthPx.value, maxPx));
  return 100 - (px / available) * 100;
});

/** pane1（diff 预览）最小百分比（200px 下限），保证拖拽时 diff 不被压爆 */
const diffMinPct = computed(() => {
  const cw = containerWidth.value;
  if (cw <= 1) return 0;
  return (MIN_DIFF_WIDTH / (cw - 1)) * 100;
});

/** 拖拽结束：pane1（diff）百分比反算目录宽像素持久化（再 clamp 一遍，防止超界值残留） */
function onTreeSplitResized(size: number): void {
  const cw = containerWidth.value;
  if (cw <= 0) return;
  const available = cw - 1;
  const maxPx = Math.max(MIN_TREE_WIDTH, available - MIN_DIFF_WIDTH);
  treePaneWidthPx.value = Math.max(
    MIN_TREE_WIDTH,
    Math.min(Math.round((available * (100 - size)) / 100), maxPx),
  );
}

/** 目录树搜索关键字 */
const searchText = ref("");

/** 树滚动容器引用（键盘导航聚焦/滚动用） */
const treeScrollRef = ref<HTMLElement | null>(null);
/** 树键盘高亮行 key（方向键移动、Enter 确认，对齐 VS Code） */
const activeTreeKey = ref<string | null>(null);
const treeFocused = ref(false);
/** 行 DOM 引用表（滚动到可见用；普通 Map 即可，无需响应式） */
const treeRowEls = new Map<string, HTMLElement>();

function setTreeRowRef(key: string, el: unknown): void {
  if (el) treeRowEls.set(key, el as HTMLElement);
  else treeRowEls.delete(key);
}

/** 当前可见树行（含搜索过滤后的展示顺序，与模板 v-for 一致） */
const visibleTreeRows = computed<GitTreeRow[]>(() =>
  displayGroups.value.flatMap((g) => g.treeRows),
);

/** 设置高亮行并滚动到可见（nearest：尽量不动，越界才滚） */
function setActiveTreeRow(row: GitTreeRow): void {
  activeTreeKey.value = row.key;
  treeRowEls.get(row.key)?.scrollIntoView({ block: "nearest" });
}

/** 树键盘导航：↑/↓ 移动高亮、Enter 确认（目录=折叠切换、文件=打开 diff）、Home/End 跳首尾 */
function onTreeKeydown(e: KeyboardEvent): void {
  const rows = visibleTreeRows.value;
  if (!rows.length) return;
  let idx = activeTreeKey.value
    ? rows.findIndex((r) => r.key === activeTreeKey.value)
    : -1;
  // 无高亮行时回退到当前已打开文件，方便 Enter 直达
  if (idx < 0 && selectedKey.value) {
    idx = rows.findIndex((r) => r.key === selectedKey.value);
  }
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      idx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1);
      setActiveTreeRow(rows[idx]);
      break;
    case "ArrowUp":
      e.preventDefault();
      idx = idx < 0 ? rows.length - 1 : Math.max(idx - 1, 0);
      setActiveTreeRow(rows[idx]);
      break;
    case "Home":
      e.preventDefault();
      setActiveTreeRow(rows[0]);
      break;
    case "End":
      e.preventDefault();
      setActiveTreeRow(rows[rows.length - 1]);
      break;
    case "Enter":
      e.preventDefault();
      if (idx < 0) idx = 0;
      const row = rows[idx];
      if (!row) return;
      if (row.isDir) toggleDir(row);
      else if (row.row) selectRow(row.row);
      break;
  }
}

/** 点击树行：同步键盘高亮 + 聚焦树容器（后续方向键直接可用）+ 原有行为 */
function onTreeRowClick(trow: GitTreeRow): void {
  activeTreeKey.value = trow.key;
  treeScrollRef.value?.focus({ preventScroll: true });
  if (trow.isDir) toggleDir(trow);
  else if (trow.row) selectRow(trow.row);
}

/** 右侧变更目录树显隐（持久化；隐藏时 LiteSplitpanes splitSize=100 → pane2 折叠） */
const showTree = useStorage("guada-git-tree-visible", true);

/** 各会话上次打开的文件 key（group:path）——切换会话回来恢复选中（持久化） */
const sessionSelection = useStorage("guada-git-session-selection", {} as Record<string, string>);

/**
 * 搜索过滤后的分组树：匹配文件行（名称/路径包含关键字）+ 保留其祖先目录行，
 * 完整展示路径链（此时折叠状态被忽略，所有祖先目录行都显示）。
 * 空关键字时原样返回 groups。
 */
const displayGroups = computed<GitGroup[]>(() => {
  const q = searchText.value.trim().toLowerCase();
  if (!q) return groups.value;

  return groups.value
    .map((g) => {
      const matchedFiles = g.treeRows.filter(
        (r) => !r.isDir && (r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)),
      );
      if (!matchedFiles.length) return null;

      const filePaths = new Set(matchedFiles.map((r) => r.path));
      const ancestorPaths = new Set<string>();
      for (const p of filePaths) {
        const parts = p.split("/");
        for (let i = 0; i < parts.length - 1; i++) {
          ancestorPaths.add(parts.slice(0, i + 1).join("/"));
        }
      }
      return {
        ...g,
        treeRows: g.treeRows.filter((r) =>
          r.isDir ? ancestorPaths.has(r.path) : filePaths.has(r.path),
        ),
      };
    })
    .filter((g): g is GitGroup => !!g);
});

/** 状态码归类：冲突 > 暂存（含部分暂存） > 未跟踪 > 未暂存修改 */
function classifyFile(f: GitFileChange): Pick<GitRow, "group" | "statusChar" | "isPartial"> {
  const idx = f.index.trim();
  const wd = f.workingDir.trim();
  const isConflict = idx === "U" || wd === "U";
  if (isConflict) {
    return { group: "conflicts", statusChar: "U", isPartial: false };
  }
  if (idx && idx !== "?") {
    return { group: "staged", statusChar: idx, isPartial: !!wd && wd !== "?" };
  }
  if (idx === "?") {
    return { group: "changes", statusChar: "?", isPartial: false };
  }
  return { group: "changes", statusChar: wd, isPartial: false };
}

const groups = computed<GitGroup[]>(() => {
  const st = status.value;
  if (!st) return [];

  const conflicts: GitRow[] = [];
  const staged: GitRow[] = [];
  const changes: GitRow[] = [];

  for (const f of st.files) {
    const c = classifyFile(f);
    const row: GitRow = { file: f, ...c };
    if (c.group === "conflicts") conflicts.push(row);
    else if (c.group === "staged") staged.push(row);
    else changes.push(row);
  }

  const result: GitGroup[] = [];
  const pushGroup = (key: string, label: string, rows: GitRow[]) => {
    if (rows.length) {
      const tree = buildTree(rows);
      const treeRows: GitTreeRow[] = [];
      flattenTree(tree, 0, key, treeRows);
      result.push({ key, label, rows, treeRows });
    }
  };
  pushGroup("conflicts", t("git.conflicts"), conflicts);
  pushGroup("staged", t("git.stagedChanges"), staged);
  pushGroup("changes", t("git.changes"), changes);
  return result;
});

function rowKey(row: GitRow): string {
  return `${row.group}:${row.file.path}`;
}

/** 按路径构建分组内的目录树（目录在前、按名称排序；叶子为文件行）。
    防御：跳过目录级条目（path 尾斜杠，如未跟踪目录/嵌入式仓库 `?? dir/`），
    空路径段不建节点 —— 保证不会出现 name="" 的假文件行 */
function buildTree(rows: GitRow[]): GitTreeNode[] {
  const roots: GitTreeNode[] = [];
  const map = new Map<string, GitTreeNode>();
  for (const r of rows) {
    if (r.file.path.endsWith("/")) continue;
    const parts = r.file.path.split("/").filter(Boolean);
    if (!parts.length) continue;
    let cur = "";
    let parent = roots;
    for (let i = 0; i < parts.length; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      let node = map.get(cur);
      if (!node) {
        node = { name: parts[i], path: cur, isDir: i < parts.length - 1, children: [], stagedCount: 0, unstagedCount: 0 };
        map.set(cur, node);
        parent.push(node);
      }
      if (i === parts.length - 1) node.row = r;
      parent = node.children;
    }
  }
  aggregateCounts(roots);
  sortTree(roots);
  return roots;
}

/** 自底向上聚合子树内已暂存/未暂存文件数（目录行 + / − 按钮显隐依据） */
function aggregateCounts(nodes: GitTreeNode[]): void {
  for (const n of nodes) {
    if (n.isDir) {
      aggregateCounts(n.children);
      n.stagedCount = n.children.reduce((s, c) => s + c.stagedCount, 0);
      n.unstagedCount = n.children.reduce((s, c) => s + c.unstagedCount, 0);
    } else {
      n.stagedCount = n.row?.group === "staged" ? 1 : 0;
      n.unstagedCount = n.row?.group !== "staged" ? 1 : 0;
    }
  }
}

function sortTree(nodes: GitTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const n of nodes) sortTree(n.children);
}

/** 树 → 扁平行：目录行后紧跟其可见子行（折叠的目录不展开） */
function flattenTree(nodes: GitTreeNode[], depth: number, groupKey: string, out: GitTreeRow[]): void {
  for (const n of nodes) {
    if (n.isDir) {
      const key = `d:${groupKey}:${n.path}`;
      out.push({
        key, path: n.path, name: n.name, depth, isDir: true,
        stagedCount: n.stagedCount, unstagedCount: n.unstagedCount,
      });
      if (!collapsedDirs.value.has(key)) {
        flattenTree(n.children, depth + 1, groupKey, out);
      }
    } else if (n.row) {
      out.push({ key: rowKey(n.row), path: n.path, name: n.name, depth, isDir: false, row: n.row });
    }
  }
}

/** 收集分组内所有真实目录的 key（用于折叠状态修剪） */
function collectDirKeys(rows: GitRow[], groupKey: string, out: Set<string>): void {
  for (const r of rows) {
    const parts = r.file.path.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      out.add(`d:${groupKey}:${parts.slice(0, i + 1).join("/")}`);
    }
  }
}

/** 当前选中行（从分组中反查，refresh 后跟随新状态） */
const selectedRow = computed<GitRow | null>(() => {
  if (!selectedKey.value) return null;
  for (const g of groups.value) {
    for (const r of g.rows) {
      if (rowKey(r) === selectedKey.value) return r;
    }
  }
  return null;
});

const selectedLines = computed<DiffLine[]>(() => {
  return selectedKey.value ? diffLines.value[selectedKey.value] || [] : [];
});

/** split 视图数据：unified 原始行 → 配对双列行（del+add 配对成一行，左右行数一一对应） */
const splitLines = computed<SplitDiffLine[]>(() => unifiedToSplit(selectedLines.value));

/** 选中文件已加载 diff 的增删统计（diff 头部 +N -M 徽标；unified 原始行计数） */
const selectedStats = computed<DiffStats | null>(() => {
  const lines = selectedLines.value;
  return lines.length ? computeStats(lines) : null;
});

function computeStats(lines: DiffLine[]): DiffStats {
  let add = 0;
  let del = 0;
  for (const l of lines) {
    if (l.type === "add") add++;
    else if (l.type === "del") del++;
  }
  return { add, del };
}

/**
 * unified 原始行 → split 配对行（VS Code 风格，两列行数一一对应）：
 * - 连续的 add/del 段：del 与 add 按序配对成 pair 行（左=旧右=新），
 *   配不完的多余 del → del-only 行、多余 add → add-only 行；
 * - ctx 行两列相同；gap/binary/hunk 原样保留。
 */
function unifiedToSplit(lines: DiffLine[]): SplitDiffLine[] {
  const out: SplitDiffLine[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === "add" || l.type === "del") {
      // 收集连续的 add/del 段
      const seg: DiffLine[] = [];
      while (i < lines.length && (lines[i].type === "add" || lines[i].type === "del")) {
        seg.push(lines[i]);
        i++;
      }
      const dels = seg.filter((s) => s.type === "del");
      const adds = seg.filter((s) => s.type === "add");
      // 全文模式下每列取本侧的全文高亮（oldHtml/newHtml）；降级模式无此字段，回退 html
      const pairs = Math.min(dels.length, adds.length);
      for (let k = 0; k < pairs; k++) {
        out.push({
          type: "pair",
          oldLine: dels[k].oldLine,
          oldHtml: dels[k].oldHtml ?? dels[k].html,
          newLine: adds[k].newLine,
          newHtml: adds[k].newHtml ?? adds[k].html,
        });
      }
      for (let k = pairs; k < dels.length; k++) {
        out.push({ type: "del", oldLine: dels[k].oldLine, oldHtml: dels[k].oldHtml ?? dels[k].html, newHtml: "" });
      }
      for (let k = pairs; k < adds.length; k++) {
        out.push({ type: "add", newLine: adds[k].newLine, newHtml: adds[k].newHtml ?? adds[k].html, oldHtml: "" });
      }
    } else if (l.type === "ctx") {
      out.push({ type: "ctx", oldLine: l.oldLine, newLine: l.newLine, oldHtml: l.oldHtml ?? l.html, newHtml: l.newHtml ?? l.html });
      i++;
    } else if (l.type === "gap") {
      out.push({ type: "gap", oldHtml: "", newHtml: "", gap: l.gap, newGap: l.newGap, oldLine: l.oldLine, newLine: l.newLine });
      i++;
    } else if (l.type === "binary") {
      out.push({ type: "binary", oldHtml: "", newHtml: "", html: l.html });
      i++;
    } else {
      out.push({ type: "hunk", oldHtml: "", newHtml: "", html: l.html });
      i++;
    }
  }
  return out;
}

/* 行号/内容/着色的「行类型 × 视图侧」推导已收敛到 GitDiffRow 组件（三处渲染统一） */

/** binary 文件特判：整份 diff 只有一行提示，直接全宽显示（无需双列/虚拟化） */
const isBinarySplit = computed<boolean>(() => {
  const ls = splitLines.value;
  return ls.length === 1 && ls[0].type === "binary";
});

/** binary 提示行（display 层形状，GitDiffRow 用；srcIdx 无实际意义） */
const binaryLine = computed<DisplaySplitLine>(() => ({ ...splitLines.value[0], srcIdx: 0 }));

/**
 * 拆分视图滚动：左右两列隐藏原生竖向滚动条，右侧绘制统一竖向滚动条，
 * 纵向滚动由 JS 统一驱动（单一控制源，两列永远同步）：
 * - 滚轮滚任一列 → wheel 事件 → 累加 offset → 同时 translateY 两列；
 * - 拖自定义滑块 / 点轨道 → 按比例算 offset（唯一入口）。
 * 横向滚动保留原生（每列独立，overflow-x:scroll）。
 */
const oldColRef = ref<HTMLElement | null>(null);
const newColRef = ref<HTMLElement | null>(null);
const vScrollTrackRef = ref<HTMLElement | null>(null);
const vScrollThumbRef = ref<HTMLElement | null>(null);
/** 两列内容 inner 引用（translateY 平移目标） */
const oldColInnerRef = ref<HTMLElement | null>(null);
const newColInnerRef = ref<HTMLElement | null>(null);
/**
 * 统一竖向滚动状态（translate 方式，无原生竖条）：
 * offset = 两列内容当前平移像素（唯一纵向控制源）；
 * maxOffset = 内容总高 - 视口高；thumbTop/thumbHeight 为滑块像素。
 */
const vScroll = reactive({ offset: 0, maxOffset: 0, thumbTop: 0, thumbHeight: 0, visible: false, dragging: false, focused: false });

/**
 * gap（未修改行折叠条）展开状态：
 * key = splitLines 解析层索引；展开后 gap 条替换为收起条 + 加载的 ctx 行。
 */
const gapExpanded = ref<Set<number>>(new Set());
/** 展开后加载的 ctx 行（key = splitLines 解析层索引） */
const gapRows = ref<Record<number, SplitDiffLine[]>>({});

/** display 层：解析层 splitLines + 展开的 gap 内容（gap-close 收起条 + ctx 行），每行带 srcIdx */
const displaySplitLines = computed<DisplaySplitLine[]>(() => {
  const out: DisplaySplitLine[] = [];
  splitLines.value.forEach((l, i) => {
    if (l.type === "gap" && gapExpanded.value.has(i)) {
      out.push({
        type: "gap-close",
        oldHtml: "",
        newHtml: "",
        gap: l.gap,
        oldLine: l.oldLine,
        newLine: l.newLine,
        srcIdx: i,
      });
      for (const ctx of gapRows.value[i] || []) {
        out.push({ ...ctx, srcIdx: i });
      }
    } else {
      out.push({ ...l, srcIdx: i });
    }
  });
  return out;
});

/**
 * unified 视图行：displaySplitLines 派生 —— pair 行拆成 del + add 两行
 * （连续变更段内全部 del 在前、全部 add 在后，对齐 GitHub/VS Code unified 顺序），
 * 其余行原样透传。gap 展开状态/全文高亮/行渲染由此与 split 视图天然共享。
 */
const displayUnifiedLines = computed<DisplaySplitLine[]>(() => {
  const src = displaySplitLines.value;
  const out: DisplaySplitLine[] = [];
  let i = 0;
  while (i < src.length) {
    const t = src[i].type;
    if (t === "pair" || t === "del" || t === "add") {
      // 连续变更段（pair/del/add）：先 del 侧行块，再 add 侧行块
      const run: DisplaySplitLine[] = [];
      while (i < src.length) {
        const rt = src[i].type;
        if (rt !== "pair" && rt !== "del" && rt !== "add") break;
        run.push(src[i]);
        i++;
      }
      for (const r of run) if (r.type !== "add") out.push({ ...r, type: "del" });
      for (const r of run) if (r.type !== "del") out.push({ ...r, type: "add" });
    } else {
      out.push(src[i]);
      i++;
    }
  }
  return out;
});

/**
 * 行虚拟化（对齐 VS Code 性能）：只渲染可视区 ± buffer 的行，DOM 恒为可视行数。
 * 行高固定：普通行 20px（line-height），gap/gap-close 行 30px（.git-diff-gap padding 3+3 +
 * .git-diff-gap-inner padding 2+2 + line 20）——由 GitDiffRow 的 CSS 决定，改 CSS 需同步。
 * unified / split 两视图共用同一套 metrics/slice 逻辑。
 */
const ROW_H = 20;
const GAP_ROW_H = 30;
/** 可视区外上下各多渲染的行数（快速拖拽不闪空） */
const DIFF_BUFFER_ROWS = 15;

/** 每行累计 top 与总高度（gap 展开/收起自动重算） */
function computeRowMetrics(lines: DisplaySplitLine[]): { tops: number[]; total: number } {
  const tops: number[] = [];
  let total = 0;
  for (const l of lines) {
    tops.push(total);
    total += l.type === "gap" || l.type === "gap-close" ? GAP_ROW_H : ROW_H;
  }
  return { tops, total };
}

/** split 视图行度量（基于 display 层） */
const rowMetrics = computed(() => computeRowMetrics(displaySplitLines.value));
/** unified 视图行度量（pair 已拆行，行数更多） */
const uniMetrics = computed(() => computeRowMetrics(displayUnifiedLines.value));

/** 首个 tops[i] >= target 的索引 */
function lowerBound(tops: number[], target: number): number {
  let lo = 0;
  let hi = tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 可视行范围 [start, end)（offset/viewH 由调用方给：split=JS offset，unified=原生 scrollTop） */
function computeSlice(tops: number[], offset: number, viewH: number): [number, number] {
  if (!tops.length) return [0, 0];
  const vh = viewH || 300;
  const start = lowerBound(tops, offset - DIFF_BUFFER_ROWS * ROW_H);
  const end = Math.min(lowerBound(tops, offset + vh + DIFF_BUFFER_ROWS * ROW_H) + 1, tops.length);
  return [start, end];
}

/** 列视口高度（ResizeObserver 更新，避免每帧读 clientHeight 触发 layout） */
const viewH = ref(0);

/** split 可视行范围 */
const sliceRange = computed<[number, number]>(() =>
  computeSlice(rowMetrics.value.tops, vScroll.offset, viewH.value),
);

/** split 可视行（带绝对行号索引，两列共用同一份，天然对齐） */
const splitSlice = computed<{ line: DisplaySplitLine; idx: number }[]>(() => {
  const [s, e] = sliceRange.value;
  return displaySplitLines.value.slice(s, e).map((line, i) => ({ line, idx: s + i }));
});

/**
 * unified 视图滚动与 split 完全共用同一套机制（自绘滚动条 + translateY + 行虚拟化）：
 * - uniColRef 是唯一内容列（横向原生滚动、纵向 overflow:hidden）；
 * - 纵向 offset/transform/滑块全部复用 vScroll / setColumnsOffset / updateVScroll；
 * - 显隐切换（面板 v-show display:none）时 offset 与 transform 一起保留 → 位置不丢，
 *   无独立的 uniScroll/uniViewH/观察器需要维护。
 */
const uniColRef = ref<HTMLElement | null>(null);
const uniColInnerRef = ref<HTMLElement | null>(null);

/** unified 可视行范围（与 split 共用 vScroll.offset / viewH） */
const uniSliceRange = computed<[number, number]>(() =>
  computeSlice(uniMetrics.value.tops, vScroll.offset, viewH.value),
);
const uniSlice = computed<{ line: DisplaySplitLine; idx: number }[]>(() => {
  const [s, e] = uniSliceRange.value;
  return displayUnifiedLines.value.slice(s, e).map((line, i) => ({ line, idx: s + i }));
});

function clampOffset(o: number): number {
  return Math.max(0, Math.min(o, vScroll.maxOffset));
}

/** 以当前 offset 刷新滑块（尺寸/位置/可见性）。
    轨道高度 = 列视口高（track 与列等高）——不能用 track.clientHeight：
    v-show 隐藏时轨道 display:none → clientHeight=0 → 永远测不到 → 死循环不显示。 */
function updateVScroll(): void {
  const thumb = vScrollThumbRef.value;
  if (!thumb) return;
  // 按当前视图取行度量：split=displaySplitLines，unified=displayUnifiedLines（pair 已拆行）
  const metrics = diffView.value === "split" ? rowMetrics.value : uniMetrics.value;
  const vh = viewH.value;
  const total = metrics.total;
  const max = total - vh;
  vScroll.maxOffset = Math.max(0, max);
  if (vh <= 0) {
    // 面板隐藏（祖先 display:none，列无布局）：仅隐藏滚动条，offset/transform 原样保留
    // —— 恢复显示时滚动位置不丢；若此处把 offset 归零而 transform 未同步，会失步 → 空白
    vScroll.visible = false;
    return;
  }
  if (max <= 0) {
    // 内容不足一屏：归零 offset 并同步 transform（避免 offset/transform 失步）
    vScroll.visible = false;
    vScroll.offset = 0;
    applyColumnsTransform();
    return;
  }
  const thumbH = Math.max(24, (vh / total) * vh);
  vScroll.visible = true;
  vScroll.thumbHeight = thumbH;
  vScroll.thumbTop = Math.round((vScroll.offset / max) * (vh - thumbH));
}

/** 把 vScroll.offset 应用为所有已挂载内容列的 translateY（split 两列 + unified 单列） */
function applyColumnsTransform(): void {
  const t = `translateY(${-vScroll.offset}px)`;
  if (oldColInnerRef.value) oldColInnerRef.value.style.transform = t;
  if (newColInnerRef.value) newColInnerRef.value.style.transform = t;
  if (uniColInnerRef.value) uniColInnerRef.value.style.transform = t;
}

/**
 * 统一设置各列纵向位置（拖滑块/点轨道/滚轮的唯一入口，保证永远同步）：
 * 直接 translateY 平移内容（不用 scrollTop），offset 是单一状态。
 * offset 必须圆整为整数像素：浮点 offset → translateY 亚像素平移 →
 * 非整数 DPI 缩放下行边界出现 1px 缝隙（概率性横线）。 */
function setColumnsOffset(offset: number): void {
  vScroll.offset = Math.round(clampOffset(offset));
  applyColumnsTransform();
  updateVScroll();
}

/** 列内滚轮：deltaY 累加 offset（阻止默认滚动，translate 是唯一纵向通道）；
    deltaX（Shift+滚轮/触控板横滚）手动同步各列 scrollLeft —— 默认行为已被 prevent，
    不处理的话横向滚轮会被吞掉（split 两列同步、unified 单列直接滚） */
function onColWheel(e: WheelEvent): void {
  e.preventDefault();
  if (e.deltaX) {
    let dx = e.deltaX;
    if (e.deltaMode === 1) dx *= 16;
    if (oldColRef.value) oldColRef.value.scrollLeft += dx;
    if (newColRef.value) newColRef.value.scrollLeft += dx;
    if (uniColRef.value) uniColRef.value.scrollLeft += dx;
  }
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16; // 行单位 → 像素
  setColumnsOffset(vScroll.offset + dy);
}

/**
 * 横向滚动同步：split 两列共享同一 scrollLeft（对齐 VS Code split diff）；
 * unified 单列（side="uni"）无同步对象，直接返回。
 * 一列原生横滚（拖滚动条/键盘）→ scroll 事件回写另一列；hSyncing 标志防回环
 * （赋值会触发对方 scroll 事件，rAF 后复位）。纯 scrollLeft 赋值，不涉及重绘。
 */
let hSyncing = false;

function onColScroll(e: Event, side: "old" | "new" | "uni"): void {
  if (side === "uni" || hSyncing) return;
  const from = e.currentTarget as HTMLElement;
  const to = side === "old" ? newColRef.value : oldColRef.value;
  if (!to || to.scrollLeft === from.scrollLeft) return;
  hSyncing = true;
  to.scrollLeft = from.scrollLeft;
  requestAnimationFrame(() => {
    hSyncing = false;
  });
}

/** 滑块拖拽（rAF 节流：拖拽中只改 transform + 滑块位置，不读 layout，避免卡顿） */
let dragStartY = 0;
let dragStartThumbTop = 0;
let dragRafId: number | null = null;
let pendingThumbMove: MouseEvent | null = null;

function onThumbDown(e: MouseEvent): void {
  e.preventDefault();
  dragStartY = e.clientY;
  dragStartThumbTop = vScroll.thumbTop;
  vScroll.dragging = true; // 拖拽中滑块保持高亮 + 全屏遮罩
  document.addEventListener("mousemove", onThumbMove);
  document.addEventListener("mouseup", onThumbUp);
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
}

function onThumbMove(e: MouseEvent): void {
  pendingThumbMove = e;
  if (dragRafId !== null) return;
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null;
    const ev = pendingThumbMove;
    pendingThumbMove = null;
    if (!ev) return;
    const track = vScrollTrackRef.value;
    if (!track) return;
    const trackH = track.clientHeight; // rAF 每帧一次读取可接受
    const maxTop = trackH - vScroll.thumbHeight;
    if (maxTop <= 0) return;
    const top = Math.max(0, Math.min(dragStartThumbTop + (ev.clientY - dragStartY), maxTop));
    const ratio = top / maxTop;
    // 直接改滑块位置 + 各列 transform，不调 updateVScroll（避免拖拽中 layout reflow）
    vScroll.thumbTop = top;
    const off = Math.round(ratio * vScroll.maxOffset); // 整数像素，避免亚像素横线
    vScroll.offset = off;
    applyColumnsTransform();
  });
}

function onThumbUp(): void {
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId);
    dragRafId = null;
  }
  pendingThumbMove = null;
  document.removeEventListener("mousemove", onThumbMove);
  document.removeEventListener("mouseup", onThumbUp);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  vScroll.dragging = false; // 松手恢复
  updateVScroll(); // 拖拽结束校准一次
}

/** 点轨道：滑块中心跳到鼠标位置 */
function onVScrollTrackDown(e: MouseEvent): void {
  const track = vScrollTrackRef.value;
  if (!track || !vScroll.visible) return;
  const rect = track.getBoundingClientRect();
  const ratio = (e.clientY - rect.top - vScroll.thumbHeight / 2) / (rect.height - vScroll.thumbHeight);
  setColumnsOffset(Math.max(0, Math.min(ratio, 1)) * vScroll.maxOffset);
}

/** 键盘：方向键/翻页/Home/End 调整纵向偏移（对齐原生滚动条；聚焦在 split 区域或滚动条上时）。
    仅在处理到的键上 preventDefault（模板不再用 .prevent，避免拦截其他按键） */
function onVScrollKeydown(e: KeyboardEvent): void {
  let dy = 0;
  const vh = viewH.value || 0;
  switch (e.key) {
    case "ArrowUp":
      dy = -ROW_H;
      break;
    case "ArrowDown":
      dy = ROW_H;
      break;
    case "PageUp":
      dy = -vh;
      break;
    case "PageDown":
      dy = vh;
      break;
    case "Home":
      setColumnsOffset(0);
      e.preventDefault();
      return;
    case "End":
      setColumnsOffset(vScroll.maxOffset);
      e.preventDefault();
      return;
    default:
      return; // 其他键不拦截
  }
  e.preventDefault();
  setColumnsOffset(vScroll.offset + dy);
}

/** 内容/尺寸变化后刷新滚动条（列挂载/视图切换/加载完成/窗口缩放） */
let vScrollResizeObserver: ResizeObserver | null = null;
watch(
  [oldColRef, newColRef, uniColRef, diffView, splitLines],
  () => {
    vScrollResizeObserver?.disconnect();
    // 观察当前视图的内容列（split 取左列即可，两列等高；unified 取单列）
    const el = diffView.value === "split" ? oldColRef.value : uniColRef.value;
    if (el) {
      vScrollResizeObserver = new ResizeObserver(() => {
        viewH.value = el.clientHeight;
        updateVScroll();
      });
      vScrollResizeObserver.observe(el);
    }
    void nextTick(() => {
      // 列挂载/视图切换后必须把 offset 应用为 transform —— 否则 offset 与 transform
      // 失步（切到 split 时 offset 有残留而 transform 为初始 0）→ 渲染行全部在视口外 → 空白
      applyColumnsTransform();
      updateVScroll();
    });
  },
  { flush: "post" },
);

/** 内容行数变化（gap 展开/收起、加载完成）后刷新滚动条上限与滑块 */
watch([rowMetrics, uniMetrics], () => updateVScroll(), { flush: "post" });

/** 切换选中文件：记录本会话打开的文件（切会话回来恢复）、偏移复位到顶部、清空 gap 展开状态 */
watch(
  () => selectedKey.value,
  () => {
    if (props.sessionId && selectedKey.value) {
      sessionSelection.value[props.sessionId] = selectedKey.value;
    }
    vScroll.offset = 0;
    applyColumnsTransform();
    gapExpanded.value = new Set();
    gapRows.value = {};
  },
);

/** 工具栏单按钮切换 unified/split（图标显示目标视图） */
function toggleDiffView(): void {
  diffView.value = diffView.value === "unified" ? "split" : "unified";
}

/** 切换 diff 视图：两种视图共用同一套滚动状态，切换即复位到顶部（布局不同，保留位置无意义）。
    必须同步 transform，否则 offset=0 而 transform 残留旧值 → 空白 */
watch(diffView, () => {
  vScroll.offset = 0;
  applyColumnsTransform();
  void nextTick(updateVScroll);
});

/* 外部 git 变化自动刷新已上收至 GitStore（概览面板常驻时同样生效），此处不再订阅 */

onUnmounted(() => {
  vScrollResizeObserver?.disconnect();
  vScrollResizeObserver = null;
  document.removeEventListener("mousemove", onThumbMove);
  document.removeEventListener("mouseup", onThumbUp);
  bodyResizeObserver?.disconnect();
  bodyResizeObserver = null;
});

function statusClass(row: GitRow): string {
  const c = row.statusChar;
  if (c === "A" || c === "?") return "added";
  if (c === "D") return "deleted";
  if (c === "R") return "renamed";
  if (c === "U") return "conflict";
  return "modified";
}

function getLanguage(filePath: string): string {
  const dotIdx = filePath.lastIndexOf(".");
  if (dotIdx === -1) return "plaintext";
  return getLanguageFromExtension(filePath.slice(dotIdx)) || "plaintext";
}

/**
 * 整段高亮（而非逐行）：块注释/模板字符串/多行字符串等跨行 token 需要上下文，
 * 逐行高亮会丢失 → 部分代码块无高亮。
 * 做法：连续代码行段（同一 hunk 内的 add/del/ctx）按「旧侧（del+ctx）/
 * 新侧（add+ctx）」各拼成一段完整文本整体高亮，highlightCodeLines 内部
 * 处理跨行 span 的关闭/重开后按行拆回，写回每行 html。
 * 无 text 字段的行（截断提示/异常兜底行）不参与，html 保持原值。
 */
function highlightParsedLines(lines: DiffLine[], lang: string): void {
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const isCode = l.type === "add" || l.type === "del" || l.type === "ctx";
    if (!isCode || l.text === undefined) {
      i++;
      continue;
    }
    const seg: DiffLine[] = [];
    let j = i;
    while (j < lines.length) {
      const s = lines[j];
      const sCode = s.type === "add" || s.type === "del" || s.type === "ctx";
      if (!sCode || s.text === undefined) break;
      seg.push(s);
      j++;
    }
    // 旧侧文本 = del + ctx（旧文件连续）；新侧文本 = add + ctx（新文件连续）
    const oldSide = seg.filter((s) => s.type !== "add");
    const newSide = seg.filter((s) => s.type !== "del");
    const oldHtml = highlightCodeLines(oldSide.map((s) => s.text ?? "").join("\n"), lang);
    const newHtml = highlightCodeLines(newSide.map((s) => s.text ?? "").join("\n"), lang);
    oldSide.forEach((s, k) => { s.html = oldHtml[k] || "&nbsp;"; });
    // ctx 行两侧内容相同，新侧结果覆盖即可（同 hunk 内两侧高亮一致）
    newSide.forEach((s, k) => { s.html = newHtml[k] || "&nbsp;"; });
    i = j;
  }
}

/**
 * 宽度锚层行内容：代码行取本侧（old/new/uni）自身内容（uni 按行类型取，同 GitDiffRow）；
 * gap/gap-close 条渲染其真实文案（锚层 padding 已覆盖图标等 chrome 宽度）。
 * 各容器各自测量 —— 用对侧内容撑宽会让本容器滚动区超出本容器任何实际行。
 */
function sizeLineHtml(line: DisplaySplitLine, side: "old" | "new" | "uni"): string {
  if (line.type === "gap" || line.type === "gap-close") {
    const count = side === "new" ? (line.newGap ?? line.gap ?? 0) : (line.gap ?? 0);
    const base = t("git.unmodifiedLines", { count });
    return escapeHtml(line.type === "gap-close" ? `${base} · ${t("git.collapse")}` : base);
  }
  const content =
    side === "old"
      ? line.oldHtml
      : side === "new"
        ? line.newHtml
        : line.type === "del"
          ? line.oldHtml
          : line.type === "add"
            ? line.newHtml
            : line.newHtml || line.oldHtml;
  return line.html || content || "&nbsp;";
}

/** 仅解析（不高亮）：代码行原文存 text，高亮由 renderDiff 末尾整段进行（跨行 token 上下文） */
function parseUnifiedDiff(text: string): DiffLine[] {
  const rawLines = text.split("\n");
  const result: DiffLine[] = [];

  // hunk 行号跟踪：@@ -start[,count] +start[,count] @@
  let oldLineNum: number | undefined;
  let newLineNum: number | undefined;
  /** 下一个未被 diff 覆盖的旧文件行号，用于计算 hunk 之间的未修改行数 */
  let nextOldLine = 1;
  /** 下一个未被 diff 覆盖的新文件行号（split 视图右列 gap 条用） */
  let nextNewLine = 1;

  for (const raw of rawLines) {
    if (result.length >= MAX_DIFF_LINES) {
      result.push({
        type: "ctx",
        sign: " ",
        html: escapeHtml(t("git.diffTooLarge", { count: MAX_DIFF_LINES })),
      });
      break;
    }
    if (raw.startsWith("@@")) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLineNum = match ? parseInt(match[1], 10) : undefined;
      newLineNum = match ? parseInt(match[2], 10) : undefined;
      if (oldLineNum !== undefined && newLineNum !== undefined) {
        // hunk 头渲染为「N 行未修改」折叠条；相邻 hunk（gap<=0）不显示。
        // 记录区间起点行号（oldLine/newLine），点击展开时用于行号递增与后端取行
        const gap = oldLineNum - nextOldLine;
        const newGap = newLineNum - nextNewLine;
        if (gap > 0) {
          result.push({
            type: "gap",
            sign: "",
            html: "",
            gap,
            newGap,
            oldLine: nextOldLine,
            newLine: nextNewLine,
          });
        }
      } else {
        result.push({ type: "hunk", sign: "@@", html: escapeHtml(raw) });
      }
    } else if (
      raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") ||
      raw.startsWith("index ") || raw.startsWith("new file") || raw.startsWith("deleted file") ||
      raw.startsWith("old mode") || raw.startsWith("new mode") || raw.startsWith("similarity") ||
      raw.startsWith("rename ") || raw.startsWith("Binary files") ||
      raw.startsWith("\\ No newline at end of file")
    ) {
      // 文件头部元数据行 + 无换行符标记：跳过
    } else if (raw.startsWith("+")) {
      result.push({
        type: "add",
        sign: "+",
        html: "",
        text: raw.slice(1),
        newLine: newLineNum,
      });
      if (newLineNum !== undefined) {
        nextNewLine = newLineNum + 1;
        newLineNum++;
      }
    } else if (raw.startsWith("-")) {
      result.push({
        type: "del",
        sign: "-",
        html: "",
        text: raw.slice(1),
        oldLine: oldLineNum,
      });
      if (oldLineNum !== undefined) nextOldLine = ++oldLineNum;
    } else if (raw.startsWith(" ")) {
      result.push({
        type: "ctx",
        sign: " ",
        html: "",
        text: raw.slice(1),
        oldLine: oldLineNum,
        newLine: newLineNum,
      });
      if (oldLineNum !== undefined) nextOldLine = ++oldLineNum;
      if (newLineNum !== undefined) nextNewLine = ++newLineNum;
    } else {
      result.push({ type: "ctx", sign: " ", html: escapeHtml(raw) });
    }
  }
  return result;
}

/** 文件内容 → 行数组：去掉末尾换行产生的空尾巴（"a\n" → ["a"]；"" → []） */
function splitFileLines(content: string): string[] {
  const arr = content.split("\n");
  if (arr.length && arr[arr.length - 1] === "") arr.pop();
  return arr;
}

/**
 * 全文模式：按行号从全文高亮数组取每行内容
 * （del→旧侧，add→新侧，ctx→两侧各自取 —— split 视图两列各得本侧精确高亮）。
 * 无 text 字段的兜底行（截断提示等）跳过，保持原 html。
 */
function resolveFullHtml(lines: DiffLine[], full: FullHighlight): void {
  const pick = (arr: string[], line?: number): string =>
    (line !== undefined && arr[line - 1]) || "&nbsp;";
  for (const l of lines) {
    if (l.type === "add") {
      l.newHtml = pick(full.newHtml, l.newLine);
      l.html = l.newHtml;
    } else if (l.type === "del") {
      l.oldHtml = pick(full.oldHtml, l.oldLine);
      l.html = l.oldHtml;
    } else if (l.type === "ctx" && l.text !== undefined) {
      l.oldHtml = pick(full.oldHtml, l.oldLine);
      l.newHtml = pick(full.newHtml, l.newLine);
      l.html = l.newHtml;
    }
  }
}

/**
 * diff 响应 → 渲染行。返回全文高亮（全文模式）或 null（降级模式），
 * 由调用方（loadDiff）在确认响应未过期后统一写入 fullHighlight ——
 * 避免在途旧响应覆盖新文件的全文高亮。
 */
function renderDiff(
  res: GitDiff,
  filePath: string,
): { lines: DiffLine[]; full: FullHighlight | null } {
  const lang = getLanguage(filePath);

  // 二进制文件（图片等）/ 体积超限文件（单行极长的打包产物等）：不渲染内容，
  // 显示居中提示行（binary 行复用 GitDiffRow 的居中占满样式）
  if (res.binary || res.tooLarge) {
    return {
      lines: [
        {
          type: "binary" as const,
          sign: "",
          html: escapeHtml(res.tooLarge ? t("git.fileTooLarge") : t("git.binaryNotPreview")),
        },
      ],
      full: null,
    };
  }

  // 全文模式：后端附带两侧完整内容 → diff 只作对齐信息（行号/类型/gap 区间），
  // 行内容按行号从全文取；全文一次高亮（跨行 token 上下文完整），
  // gap 展开也无需再请求后端（loadGapRows 本地生成）。
  if (res.oldContent !== undefined && res.newContent !== undefined) {
    const oldLines = splitFileLines(res.oldContent);
    const newLines = splitFileLines(res.newContent);
    const full: FullHighlight = {
      oldHtml: highlightCodeLines(oldLines.join("\n"), lang),
      newHtml: highlightCodeLines(newLines.join("\n"), lang),
    };
    let result: DiffLine[];
    if (res.type === "new-file") {
      // 未跟踪文件：全新增，无旧行号，新行号从 1 递增
      result = newLines.slice(0, MAX_DIFF_LINES).map((_, i) => ({
        type: "add" as const,
        sign: "+",
        html: "",
        newLine: i + 1,
      }));
      if (newLines.length > MAX_DIFF_LINES) {
        result.push({
          type: "ctx",
          sign: " ",
          html: escapeHtml(t("git.diffTooLarge", { count: MAX_DIFF_LINES })),
        });
      }
    } else {
      result = parseUnifiedDiff(res.diff || "");
    }
    resolveFullHtml(result, full);
    return { lines: result, full };
  }

  // 降级模式（任一侧全文超体积上限未附带）：hunk 内整段高亮；gap 展开仍走后端拉取
  if (res.type === "new-file") {
    const lines = splitFileLines(res.content || "");
    const result: DiffLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (result.length >= MAX_DIFF_LINES) {
        result.push({
          type: "ctx",
          sign: " ",
          html: escapeHtml(t("git.diffTooLarge", { count: MAX_DIFF_LINES })),
        });
        break;
      }
      // 未跟踪文件：全新增，无旧行号，新行号从 1 递增
      result.push({ type: "add", sign: "+", html: "", text: lines[i], newLine: i + 1 });
    }
    // 整段高亮：new-file 段即完整新文件，跨行 token 上下文完整
    highlightParsedLines(result, lang);
    return { lines: result, full: null };
  }

  const result = parseUnifiedDiff(res.diff || "");
  highlightParsedLines(result, lang);
  return { lines: result, full: null };
}

/** 点击文件：选中并加载 diff（同文件重复点击忽略；切换选中即丢弃旧内容重新拉取） */
function selectRow(row: GitRow): void {
  const key = rowKey(row);
  if (selectedKey.value === key) return;
  selectedKey.value = key;
  diffLoadSeq++;
  diffLines.value = {};
  void loadDiff(row);
}

/** 清空 diff 选中（关闭按钮 / 分支切换 / 提交后） */
function clearSelection(): void {
  selectedKey.value = null;
  loadingKey.value = null;
  diffLines.value = {};
  fullHighlight.value = null;
  diffLoadSeq++;
}

async function loadDiff(row: GitRow): Promise<void> {
  if (!props.sessionId) return;
  const key = rowKey(row);
  const seq = ++diffLoadSeq;
  loadingKey.value = key;
  fullHighlight.value = null; // 旧文件全文高亮即刻失效，新值由下方当前响应写入
  try {
    const res = await apiService.getGitDiff(props.sessionId, row.file.path, row.group === "staged");
    const { lines, full } = renderDiff(res, row.file.path);
    // 加载期间选中被切换/清空时丢弃过期响应（含其全文高亮，不写入）
    if (seq === diffLoadSeq && selectedKey.value === key) {
      diffLines.value = { [key]: lines };
      fullHighlight.value = full;
    }
  } catch {
    if (seq === diffLoadSeq && selectedKey.value === key) {
      ElMessage.error(t("git.loadFailed"));
      diffLines.value = { [key]: [] };
      fullHighlight.value = null;
    }
  } finally {
    if (seq === diffLoadSeq) loadingKey.value = null;
  }
}

function toggleDir(trow: GitTreeRow): void {
  const next = new Set(collapsedDirs.value);
  if (next.has(trow.key)) next.delete(trow.key);
  else next.add(trow.key);
  collapsedDirs.value = next;
}

/**
 * 点击未修改行折叠条：展开/收起。
 * 展开：立即标记（收起条 + 空内容先占位），异步从 git 读取该区间实际行内容（ctx 行）。
 */
async function toggleGap(line: DisplaySplitLine): Promise<void> {
  const idx = line.srcIdx;
  if (gapExpanded.value.has(idx)) {
    const next = new Set(gapExpanded.value);
    next.delete(idx);
    gapExpanded.value = next;
    return;
  }
  const next = new Set(gapExpanded.value);
  next.add(idx);
  gapExpanded.value = next;
  await loadGapRows(idx);
}

/**
 * 生成 gap 区间的 ctx 行：
 * - 全文模式：行内容已在本地（fullHighlight），按行号直接取，无需请求后端；
 * - 降级模式（超大文件无全文）：从后端读取旧侧行区间再整段高亮。
 */
async function loadGapRows(idx: number): Promise<void> {
  if (gapRows.value[idx]) return;
  const src = splitLines.value[idx];
  if (!src || src.type !== "gap" || src.oldLine === undefined || !src.gap) return;

  const full = fullHighlight.value;
  if (full) {
    const newStart = src.newLine ?? src.oldLine;
    const lines: SplitDiffLine[] = [];
    for (let i = 0; i < src.gap; i++) {
      // gap = 两侧完全相同的未修改行，取旧侧高亮即可（两列共用）
      const html = full.oldHtml[src.oldLine + i - 1] || "&nbsp;";
      lines.push({
        type: "ctx",
        oldLine: src.oldLine + i,
        newLine: newStart + i,
        oldHtml: html,
        newHtml: html,
      });
    }
    gapRows.value = { ...gapRows.value, [idx]: lines };
    return;
  }

  if (!props.sessionId) return;
  const row = selectedRow.value;
  if (!row) return;
  // 展开一次最多 200 行（后端同样 cap）
  const to = Math.min(src.oldLine + src.gap - 1, src.oldLine + 199);
  try {
    const res = await apiService.getGitFileLines(
      props.sessionId,
      row.file.path,
      row.group === "staged",
      src.oldLine,
      to,
    );
    const lang = getLanguage(row.file.path);
    const newStart = src.newLine ?? src.oldLine;
    // gap 区间是连续文本：整段一次高亮再拆行（跨行 token 上下文，与 diff 行一致）
    const texts = res.content.split("\n");
    const htmls = highlightCodeLines(texts.join("\n"), lang);
    const lines: SplitDiffLine[] = texts.map((text, i) => {
      const html = htmls[i] || "&nbsp;";
      return {
        type: "ctx",
        oldLine: src.oldLine! + i,
        newLine: newStart + i,
        oldHtml: html,
        newHtml: html,
      };
    });
    gapRows.value = { ...gapRows.value, [idx]: lines };
  } catch {
    ElMessage.error(t("git.loadFailed"));
    // 加载失败自动收起
    const s = new Set(gapExpanded.value);
    s.delete(idx);
    gapExpanded.value = s;
  }
}

/**
 * 刷新：数据获取（status/branches）已上收至 GitStore（概览面板常驻共用）。
 * 本面板只负责刷新后的本地后处理：折叠目录修剪 + 选中保持/恢复 + diff 重拉。
 */
let lastHandledRefreshSeq = 0;

/** 选中保持/恢复（基于当前 selectedKey + store 最新 status）：
 *  1) 当前选中路径仍在变更列表中 → 按新分组重载 diff；
 *  2) 否则尝试恢复本会话上次打开的文件（切会话回来时选中已被清空）；
 *  3) 都不存在 → 清空选中。 */
function postProcessSelection(): void {
  const st = git.status;
  if (!st) return;

  // 折叠状态修剪：仅保留仍存在的目录（refresh 只增不减，否则残留幽灵目录）
  const validDirs = new Set<string>();
  for (const g of groups.value) collectDirKeys(g.rows, g.key, validDirs);
  collapsedDirs.value = new Set([...collapsedDirs.value].filter((k) => validDirs.has(k)));

  let target: GitRow | null = null;
  const cur = selectedKey.value;
  if (cur) {
    const path = cur.split(":").slice(1).join(":");
    const f = st.files.find((ff) => ff.path === path);
    if (f) target = { file: f, ...classifyFile(f) };
  }
  if (!target && props.sessionId && sessionSelection.value[props.sessionId]) {
    const cachedPath = sessionSelection.value[props.sessionId].split(":").slice(1).join(":");
    const f = st.files.find((ff) => ff.path === cachedPath);
    if (f) target = { file: f, ...classifyFile(f) };
  }
  if (target) {
    selectedKey.value = `${target.group}:${target.file.path}`;
    diffLines.value = {};
    void loadDiff(target);
  } else {
    clearSelection();
  }
}

async function refresh(): Promise<void> {
  await git.refresh();
  lastHandledRefreshSeq = git.refreshSeq;
  postProcessSelection();
}

/** store 自动刷新（外部 git 操作事件）完成后，面板同步做选中恢复/diff 重拉 */
watch(
  () => git.refreshSeq,
  () => {
    if (git.refreshSeq !== lastHandledRefreshSeq) {
      lastHandledRefreshSeq = git.refreshSeq;
      postProcessSelection();
    }
  },
);

async function stageFile(row: GitRow): Promise<void> {
  if (!props.sessionId) return;
  git.markGitWrite();
  try {
    await apiService.gitStage(props.sessionId, [row.file.path]);
    await refresh();
  } catch {
    ElMessage.error(t("git.stageFailed"));
  }
}

async function unstageFile(row: GitRow): Promise<void> {
  if (!props.sessionId) return;
  git.markGitWrite();
  try {
    await apiService.gitUnstage(props.sessionId, [row.file.path]);
    await refresh();
  } catch {
    ElMessage.error(t("git.unstageFailed"));
  }
}

/** 目录下所有文件行（分组内路径前缀匹配，聚合计数已保证数量正确） */
function dirRows(group: GitGroup, trow: GitTreeRow): GitRow[] {
  const prefix = trow.path + "/";
  return group.rows.filter((r) => r.file.path.startsWith(prefix));
}

/** 暂存目录下全部变更文件（+ 按钮） */
async function stageDir(group: GitGroup, trow: GitTreeRow): Promise<void> {
  if (!props.sessionId) return;
  const paths = dirRows(group, trow)
    .filter((r) => r.group !== "staged")
    .map((r) => r.file.path);
  if (!paths.length) return;
  git.markGitWrite();
  try {
    await apiService.gitStage(props.sessionId, paths);
    await refresh();
  } catch {
    ElMessage.error(t("git.stageFailed"));
  }
}

/** 取消暂存目录下全部文件（− 按钮） */
async function unstageDir(group: GitGroup, trow: GitTreeRow): Promise<void> {
  if (!props.sessionId) return;
  const paths = dirRows(group, trow)
    .filter((r) => r.group === "staged")
    .map((r) => r.file.path);
  if (!paths.length) return;
  git.markGitWrite();
  try {
    await apiService.gitUnstage(props.sessionId, paths);
    await refresh();
  } catch {
    ElMessage.error(t("git.unstageFailed"));
  }
}

watch(
  () => props.sessionId,
  () => {
    // 数据（status/branches/分支/提交弹窗）由 GitStore.bindSession 管理
    git.bindSession(props.sessionId);
    clearSelection();
    collapsedDirs.value = new Set();
    activeTreeKey.value = null;
    treeFocused.value = false;
  },
  { immediate: true },
);

defineExpose({ refresh });
</script>

<style scoped>
.git-changes-panel {
  background: var(--color-bg);
}

.git-tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-gray);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, color 0.15s ease;
}

/* hover/active 参考标签栏 seg-btn：hover 用侧栏 hover 底、active 用侧栏 active 底，文字色不变 */
.git-tool-btn:hover:not(:disabled) {
  background: var(--color-sidebar-bg-hover);
  color: var(--color-text);
}

.git-tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.git-tool-btn .is-loading {
  animation: git-spin 1s linear infinite;
}

/* ── 顶部工具栏（单行紧凑，简洁风格：扁平无边框 + 微悬停底） ── */
.git-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
}

/* 分支 chip：无边框扁平按钮 + DropdownMenu 下拉（替代 el-select 原生样式） */
.git-branch-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: var(--size-text-sm);
  cursor: pointer;
  max-width: 200px;
  transition: background 0.15s ease;
}
.git-branch-chip:hover:not(:disabled) {
  background: var(--color-sidebar-bg-hover);
}
.git-branch-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.git-branch-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-branch-chip-chevron {
  color: var(--color-text-disabled);
  flex-shrink: 0;
}

/* 分支下拉菜单：限高滚动，选中项 ✓ 列对齐 */
.git-branch-menu {
  max-height: 260px;
  overflow-y: auto;
}
.git-branch-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 140px;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: var(--size-text-sm);
}
.git-branch-menu-check {
  width: 12px;
  flex-shrink: 0;
  color: var(--color-primary);
}
.git-branch-menu-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-toolbar-stats {
  font-size: 12px;
}

.git-toolbar-ab {
  font-size: 11px;
  color: var(--color-text-disabled);
  white-space: nowrap;
}

/* 目录树开关激活态：对齐标签栏 seg-btn.active —— 仅背景高亮，文字颜色不变 */
.git-tool-btn--active {
  color: var(--color-text);
  background: var(--color-sidebar-bg-active);
}

/* 提交按钮：胶囊（图片同款白底细边圆角 pill） */
.git-commit-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.git-commit-btn:hover:not(:disabled) {
  background: var(--color-sidebar-bg-hover);
}
.git-commit-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}


@keyframes git-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.git-group-header {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-gray);
  padding: 8px 12px 4px;
}

/* ── 拆分视图（两列：旧文件 | 新文件） ── */

.git-diff-split {
  width: 100%;
  /* 高度由 .git-diff-pane--split 的 flex 布局撑满（flex:1 min-height:0） */
}

/* 左右两列并排，各占一半（flex:1 min-width:0） */
.git-diff-split-cols {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
}

/* 容器可聚焦（tabindex=0）支持键盘滚动，聚焦时不显示默认 outline */
.git-diff-split-cols:focus {
  outline: none;
}

/* 每列：横向原生滚动（各自独立，互不顶开）；纵向**不滚动**（overflow-y:hidden，
   无原生竖条）——内容由 inner translateY + 右侧统一滚动条 JS 控制 */
.git-diff-split-col {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-x: scroll;
  overflow-y: hidden;
}

/* 内容平移层（spacer）：height 由 JS 设为总内容高，translateY(-offset) 由 JS 统一控制
   （两列同一 offset，永远同步）。
   宽度跟随内容：width:max-content + min-width:100% —— 短行时 = 容器宽（背景铺满可视区），
   长行时 = 内容宽（由下方宽度锚层 .git-diff-split-col-size 撑宽）→ 行背景铺满整行、可横向滚动 */
.git-diff-split-col-inner {
  position: relative;
  width: max-content;
  min-width: 100%;
  will-change: transform;
}

/* 宽度锚层：正常流渲染所有行内容宽度（max-content），撑宽 inner →
   行（absolute left:0 right:0）宽 = inner 宽 = max(内容宽, 100%)，行背景铺满整行内容。
   虚拟化下只有可视行有 DOM，宽度锚层是唯一携带"所有行内容宽"的正常流元素；
   字体继承 .git-diff-split（12px/20px），宽度测量与实际内容一致 */
.git-diff-split-col-size {
  position: relative;
  visibility: hidden;
  height: 0;
  overflow: hidden;
  width: max-content;
  pointer-events: none;
}

.git-diff-size-line {
  display: block;
  width: max-content;
  white-space: pre;
  /* 锚层行宽必须 = 实际行宽：实际行 = 行号 48px + 内容左 padding 8px + 文本 + 右 padding 12px，
     锚层只有文本，用 padding 补齐这 68px 水平 chrome。
     缺了它：最宽实际行（absolute，会撑大列滚动区）比 inner 宽 68px →
     滚动区右端多出一段"只有最宽行才有背景"的区域（短行 min-width:100% 只到 inner 宽）。
     gap/hunk 行的真实 chrome（≤48px）比 68px 小，过测无害（欠测才会露底） */
  padding-left: 56px;
  padding-right: 12px;
}

/* 行样式（.git-diff-line / 行号 / 内容 / add·del·placeholder 着色 / gap / hunk / binary /
   虚拟化定位 .git-diff-vrow）统一由 GitDiffRow.vue 持有（unified 与 split 两列共用） */

.git-diff-split-col-divider {
  flex-shrink: 0;
  width: 1px;
  background: var(--color-surface-border);
}

/* 统一竖向滚动条：两列纵向滚动的单一控制入口（拖滑块/点轨道 → JS 同步两列）。
   轨道始终透明（无 hover 背景层，保持隐藏态），只有滑块可见 */
.git-diff-vscroll {
  flex-shrink: 0;
  width: 10px;
  height: 100%;
  position: relative;
  cursor: pointer;
}

.git-diff-vscroll-thumb {
  position: absolute;
  left: 2px;
  right: 2px;
  border-radius: 3px;
  background: var(--color-border);
  cursor: pointer;
  transition: background 0.15s ease;
}

.git-diff-vscroll-thumb:hover,
/* 拖拽中强制保持高亮（鼠标离开滑块也不消失，原生滚动条行为） */
.git-diff-vscroll-thumb.dragging,
/* 轨道聚焦时滑块提亮（键盘可操作指示） */
.git-diff-vscroll.focused .git-diff-vscroll-thumb {
  background: var(--color-text-disabled);
}

/* 拖拽遮罩：全屏，阻止其他元素响应（原生滚动条拖拽时鼠标捕获，其他元素不响应） */
.git-diff-vscroll-mask {
  position: fixed;
  inset: 0;
  z-index: 99999;
  cursor: grabbing;
}

/* ── 右栏：变更文件目录树 ── */
.git-body {
  border-top: 1px solid var(--color-surface-border);
}

.git-tree-pane {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── 目录树搜索框（固定在顶部，不随列表滚动；背景与面板同色，用边框区分） ── */
.git-tree-search {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 左右 margin/padding 与 .git-tree-row 一致（8px）：左缘与行背景块对齐、
     图标起点（16px）与行文本起点对齐，不再比目录树缩进一截 */
  margin: 8px 8px 6px;
  padding: 0 8px;
  height: 30px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text-disabled);
}

.git-tree-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--color-text);
}

.git-tree-search-input::placeholder {
  color: var(--color-text-disabled);
}

.git-tree-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-disabled);
  cursor: pointer;
  flex-shrink: 0;
}

.git-tree-search-clear:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

/* 树列表滚动区（搜索框保持固定） */
.git-tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.git-tree-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  /* 左右留 8px 外边距（hover 背景块不贴容器边）；
     垂直方向不留间距（margin:0）——缩进指引线由每行 ::before 拼接，行间有缝隙会断线 */
  margin: 0 8px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 14px;
  border-radius: 6px;
  white-space: nowrap;
}

/* 缩进指引竖线：每层缩进（14px）一条 1px 线，线画在格子**中心**（6-7px 段），
   与图标（chevron 12px 中心 6px）居中对齐——线不再紧贴图标右侧；
   depth=0 时 --indent=0px 宽度为 0 不显示；行间 2px margin 处自然断开（分段指引线） */
.git-tree-row::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 0;
  bottom: 0;
  width: var(--indent, 0px);
  background-image: repeating-linear-gradient(
    to right,
    transparent 0 6px,
    var(--color-surface-border) 6px 7px,
    transparent 7px 14px
  );
  pointer-events: none;
}

.git-tree-row:hover {
  /* 与全局侧边栏 hover 一致（--color-sidebar-bg-hover：浅色 rgba(40,5,5,0.05) 微透明，暗色 #2f3131） */
  background: var(--color-sidebar-bg-hover);
}

/* 树键盘导航高亮行：方向键移动（VS Code 风格），无需鼠标悬停即可见；
   与 hover 区分：用对话高亮底色，避免与悬停完全同色分不清焦点在哪 */
.git-tree-row--active {
  background: var(--color-conversation-bg-active);
}

/* 树滚动容器可聚焦（键盘导航），去掉聚焦外框 */
.git-tree-scroll:focus {
  outline: none;
}

.git-tree-row--dir {
  font-weight: 500;
  color: var(--color-text);
}

.git-tree-row--partial .git-tree-name {
  color: var(--color-warning);
}

/* 选中行：与 hover 同一颜色（--color-sidebar-bg-hover，微透明），不加深 */
.git-tree-row.selected {
  background: var(--color-sidebar-bg-hover);
}

.git-tree-chevron {
  flex-shrink: 0;
  color: var(--color-text-disabled);
  transition: transform 0.15s ease;
}

.git-tree-chevron.expanded {
  transform: rotate(90deg);
}

.git-tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text);
}

.git-status {
  width: 18px;
  text-align: center;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.git-status--modified { color: var(--color-warning); }
.git-status--added { color: var(--color-success); }
.git-status--deleted { color: var(--color-danger); }
.git-status--renamed { color: var(--color-primary); }
.git-status--conflict { color: var(--color-danger); }

.git-row-actions {
  display: none;
  flex-shrink: 0;
}

.git-tree-row:hover .git-row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.git-row-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-text-gray);
  cursor: pointer;
}

.git-row-btn:hover {
  background: var(--color-conversation-bg-active);
  color: var(--color-text);
}

/* ── 左栏：diff 预览 ── */
.git-diff-pane {
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;
}

/* 两种视图统一：pane 自身不滚动（纵向由自绘滚动条 JS 驱动，横向在列容器内原生滚动），
   header 固定在上方，内容区（.git-diff-split）填满剩余空间 */
.git-diff-pane--split {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.git-diff-pane--split .git-diff-split {
  flex: 1;
  min-height: 0;
}

/* diff 空状态（未选中文件/无变更/非仓库）：占满预览区，垂直水平居中 */
.git-diff-empty {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 16px;
  font-size: 12px;
  color: var(--color-text-disabled);
  user-select: none;
}

/* 文件头：纵向吸顶 + 横向钉左缘（背景用面板背景色 --color-bg，不透明吸顶不透内容；无底部边框线）。
   sticky 的 top 只对纵向滚动生效；必须再给 left:0 才会在横向滚动时固定 ——
   否则 unified 视图横滚（内容比视口宽）时标题栏会跟着内容滑走 */
.git-diff-header {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 上下边距加大 */
  padding: 10px 12px;
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
  background: var(--color-bg);
}

.git-diff-header-path {
  /* 不再撑满（flex:1），改为自适应宽度：标题短时紧跟统计徽标，
     标题长时可收缩并在剩余空间处省略号 */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  /* 字体用全局文本基准 --size-text-base（15px） */
  font-size: var(--size-text-base);
  color: var(--color-text);
}

.git-diff-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-gray);
  cursor: pointer;
  flex-shrink: 0;
  /* 固定在标题栏最右端 */
  margin-left: auto;
}

.git-diff-close:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}

/* ── diff 统计徽标 +N -M（紧跟标题文字，字体大小与标题统一） ── */
.git-diff-stats {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: var(--size-text-base);
  font-weight: 600;
}

.git-stat-add { color: #1a7f37; }
.git-stat-del { color: #cf222e; }
html.dark .git-stat-add { color: #3fb950; }
html.dark .git-stat-del { color: #f85149; }

.git-diff-loading {
  /* 与加载后 diff 文本位置一致：行号列 48px + 内容列左 padding 8px = 左起点 56px，
     行高 20px 与 diff 行相同 —— 加载中 → 内容过渡时文本不跳位 */
  display: flex;
  align-items: center;
  min-height: 20px;
  margin-left: 48px;
  padding: 0 12px 0 8px;
  font-size: 12px;
  line-height: 20px;
  color: var(--color-text-disabled);
}

/* 字体与行高两种视图共用（拆出行号大小不一致的根源：统一 12px/20px，
   否则列继承 pane 大字号） */
.git-diff-split {
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 12px;
  /* 整数行高（20px）：--stripe-size 公式得出整数周期 2px，行高 ÷ 周期 = 10 整除，
     每行恰好整数个条纹周期，行间虚线相位精确对齐；
     若用 1.6 × 12px = 19.2px 小数行高，浏览器瓦片化会把 1.92px 周期
     吸附成 2px，每行末尾残留半周期 → 每隔一行出现异常间距（不连续） */
  line-height: 20px;
}

/* 行样式（.git-diff-line / 行号 / 内容 / add·del·placeholder 着色 / gap / hunk / binary /
   虚拟化定位 .git-diff-vrow）统一由 GitDiffRow.vue 的 scoped 样式持有
   （unified 单列与 split 两列共用）；unified 内容列复用 .git-diff-split-col 布局 */
</style>
