<template>
  <div class="git-changes-panel h-full flex flex-col min-h-0">
    <!-- 分支栏 -->
    <div class="shrink-0 px-2 pt-2 pb-1">
      <div class="flex items-center gap-1">
        <el-icon :size="16" class="text-gray-500 dark:text-[#8b8d95] shrink-0">
          <Branch20Regular />
        </el-icon>
        <el-select
          v-model="selectedBranch"
          size="small"
          filterable
          :placeholder="t('git.branchSelectPlaceholder')"
          class="flex-1 min-w-0"
          :disabled="!isGitRepo || refreshing"
          @change="onBranchChange"
        >
          <el-option v-for="b in branches" :key="b.name" :label="b.name" :value="b.name">
            <span>{{ b.current ? '✓ ' : '' }}{{ b.name }}</span>
          </el-option>
        </el-select>
        <button class="git-tool-btn" :disabled="!isGitRepo || refreshing" @click="refresh">
          <el-icon :size="14" :class="{ 'is-loading': refreshing }">
            <Refresh />
          </el-icon>
        </button>
      </div>
      <div v-if="isGitRepo && (status?.ahead || status?.behind)"
        class="text-xs text-gray-400 dark:text-[#6b6d73] px-1 mt-0.5">
        {{ t('git.aheadBehind', { ahead: status?.ahead, behind: status?.behind }) }}
      </div>
    </div>

    <!-- 提交区 -->
    <div v-if="isGitRepo" class="shrink-0 px-2 pb-2 pt-1">
      <el-input
        v-model="commitMessage"
        type="textarea"
        :rows="2"
        resize="none"
        :placeholder="t('git.commitMessagePlaceholder')"
        @keydown.ctrl.enter="handleCommit"
        @keydown.meta.enter="handleCommit"
      />
      <div class="flex items-center gap-1 mt-1">
        <el-button type="primary" size="small" :disabled="!commitMessage.trim() || committing"
          :loading="committing" @click="handleCommit">
          {{ t('git.commit') }}
        </el-button>
        <el-button size="small" :disabled="totalChanges === 0" @click="handleStageAll">
          {{ t('git.stageAll') }}
        </el-button>
      </div>
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
          <!-- 左侧 diff 预览（split 视图下列为独立视口，pane 不滚动、header 固定） -->
          <div class="git-diff-pane" :class="{ 'git-diff-pane--split': diffView === 'split' }">
        <template v-if="selectedRow">
          <div class="git-diff-header">
            <span class="git-status" :class="`git-status--${statusClass(selectedRow)}`">{{ selectedRow.statusChar }}</span>
            <span class="git-diff-header-path" :title="selectedRow.file.path">{{ selectedRow.file.path }}</span>
            <span v-if="selectedStats && (selectedStats.add || selectedStats.del)" class="git-diff-stats">
              <span v-if="selectedStats.add" class="git-stat-add">+{{ selectedStats.add }}</span>
              <span v-if="selectedStats.del" class="git-stat-del">-{{ selectedStats.del }}</span>
            </span>
            <div class="git-diff-view-toggle">
              <button class="git-diff-view-btn" :class="{ active: diffView === 'unified' }"
                :title="t('git.unifiedView')" @click="diffView = 'unified'">
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
                  <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" stroke-width="1.3"/>
                </svg>
              </button>
              <button class="git-diff-view-btn" :class="{ active: diffView === 'split' }"
                :title="t('git.splitView')" @click="diffView = 'split'">
                <svg viewBox="0 0 16 16" width="13" height="13">
                  <rect x="1.5" y="3" width="5.8" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
                  <rect x="8.7" y="3" width="5.8" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>
                </svg>
              </button>
            </div>
            <button class="git-diff-close" :title="t('git.closePreview')" @click="clearSelection">
              <el-icon :size="12"><Close /></el-icon>
            </button>
          </div>
          <div v-if="loadingKey === selectedKey" class="git-diff-loading">
            {{ t('git.loading') }}
          </div>
          <!-- 拆分视图：左右两列（旧文件 | 新文件）各为整体滚动容器（整列只有一个横向滚动条，
               内容超长只在所在列内滚动，不互相顶开）；行号都钉各自列左缘（VS Code 风格）。
               ctx 行两列相同、add 只新列、del 只旧列；gap 行左右各显示一个跳过行数提示条 -->
          <div v-else-if="diffView === 'split'" class="git-diff-split">
            <!-- binary 文件：整份只有一行提示，全宽显示（无需双列） -->
            <div v-if="isBinarySplit" class="git-diff-line git-diff-binary">
              <span class="git-diff-content" v-html="splitLines[0].html"></span>
            </div>
            <!-- 两列容器可聚焦：点击 diff 区域即聚焦，方向键/翻页/Home/End 滚动（对齐原生） -->
            <div v-else class="git-diff-split-cols" tabindex="0"
              :class="{ focused: vScroll.focused }"
              @focus="vScroll.focused = true" @blur="vScroll.focused = false"
              @keydown="onVScrollKeydown">
              <!-- 旧文件列（横向原生滚动；纵向由 inner translateY + 统一滚动条控制；
                   行虚拟化：只渲染可视行，按固定行高绝对定位） -->
              <div ref="oldColRef" class="git-diff-split-col git-diff-split-col--old" @wheel.prevent="onColWheel">
                <div ref="oldColInnerRef" class="git-diff-split-col-inner"
                  :style="{ height: rowMetrics.total + 'px' }">
                <template v-for="item in splitSlice" :key="item.idx">
                  <!-- 未修改行折叠条：可点击展开（对齐 GitHub/VS Code） -->
                  <div v-if="item.line.type === 'gap'" class="git-diff-line git-diff-gap git-diff-split-row git-diff-gap-click"
                    :class="{ expanded: isGapExpanded(item.line.srcIdx) }"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }"
                    :title="t('git.expandUnmodified')" @click="toggleGap(item.line)">
                    <div class="git-diff-gap-inner">
                      <el-icon :size="11" class="git-diff-gap-icon"><ArrowUp /></el-icon>
                      <span>{{ t('git.unmodifiedLines', { count: item.line.gap }) }}</span>
                    </div>
                  </div>
                  <!-- 展开后的收起条 -->
                  <div v-else-if="item.line.type === 'gap-close'" class="git-diff-line git-diff-gap git-diff-split-row git-diff-gap-click"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }"
                    :title="t('git.collapseUnmodified')" @click="toggleGap(item.line)">
                    <div class="git-diff-gap-inner">
                      <el-icon :size="11" class="git-diff-gap-icon"><ArrowUp /></el-icon>
                      <span>{{ t('git.unmodifiedLines', { count: item.line.gap }) }} · {{ t('git.collapse') }}</span>
                    </div>
                  </div>
                  <div v-else-if="item.line.type === 'hunk'" class="git-diff-line git-diff-hunk git-diff-split-row"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }">
                    <span class="git-diff-content" v-html="item.line.html"></span>
                  </div>
                  <div v-else class="git-diff-split-line git-diff-split-row" :class="splitOldClass(item.line.type)"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }">
                    <span class="git-diff-line-num">{{ item.line.oldLine ?? '' }}</span>
                    <!-- 空内容必须 &nbsp; 兜底：空 span 无行盒 → 行高塌缩为 0（左右列高度错位） -->
                    <span class="git-diff-content" v-html="item.line.oldHtml || '&nbsp;'"></span>
                  </div>
                </template>
                </div>
              </div>
              <div class="git-diff-split-col-divider"></div>
              <!-- 新文件列（横向原生滚动；纵向由 translateY + JS 统一控制；行虚拟化） -->
              <div ref="newColRef" class="git-diff-split-col git-diff-split-col--new" @wheel.prevent="onColWheel">
                <div ref="newColInnerRef" class="git-diff-split-col-inner"
                  :style="{ height: rowMetrics.total + 'px' }">
                <template v-for="item in splitSlice" :key="item.idx">
                  <!-- 未修改行折叠条：可点击展开（对齐 GitHub/VS Code） -->
                  <div v-if="item.line.type === 'gap'" class="git-diff-line git-diff-gap git-diff-split-row git-diff-gap-click"
                    :class="{ expanded: isGapExpanded(item.line.srcIdx) }"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }"
                    :title="t('git.expandUnmodified')" @click="toggleGap(item.line)">
                    <div class="git-diff-gap-inner">
                      <el-icon :size="11" class="git-diff-gap-icon"><ArrowUp /></el-icon>
                      <span>{{ t('git.unmodifiedLines', { count: item.line.newGap ?? item.line.gap }) }}</span>
                    </div>
                  </div>
                  <!-- 展开后的收起条 -->
                  <div v-else-if="item.line.type === 'gap-close'" class="git-diff-line git-diff-gap git-diff-split-row git-diff-gap-click"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }"
                    :title="t('git.collapseUnmodified')" @click="toggleGap(item.line)">
                    <div class="git-diff-gap-inner">
                      <el-icon :size="11" class="git-diff-gap-icon"><ArrowUp /></el-icon>
                      <span>{{ t('git.unmodifiedLines', { count: item.line.newGap ?? item.line.gap }) }} · {{ t('git.collapse') }}</span>
                    </div>
                  </div>
                  <div v-else-if="item.line.type === 'hunk'" class="git-diff-line git-diff-hunk git-diff-split-row"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }">
                    <span class="git-diff-content" v-html="item.line.html"></span>
                  </div>
                  <div v-else class="git-diff-split-line git-diff-split-row" :class="splitNewClass(item.line.type)"
                    :style="{ top: rowMetrics.tops[item.idx] + 'px' }">
                    <span class="git-diff-line-num">{{ item.line.newLine ?? '' }}</span>
                    <!-- 空内容必须 &nbsp; 兜底（同上） -->
                    <span class="git-diff-content" v-html="item.line.newHtml || '&nbsp;'"></span>
                  </div>
                </template>
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
          <!-- 统一视图：单列（行号 + 内容），unified 原始行（add/del 分行显示） -->
          <div v-else class="git-diff-table">
            <template v-for="(line, li) in selectedLines" :key="li">
              <div v-if="line.type === 'gap'" class="git-diff-line git-diff-gap">
                <div class="git-diff-gap-inner">
                  <el-icon :size="11" class="git-diff-gap-icon"><ArrowUp /></el-icon>
                  <span>{{ t('git.unmodifiedLines', { count: line.gap }) }}</span>
                </div>
              </div>
              <div v-else class="git-diff-line" :class="diffLineClass(line.type)">
                <span class="git-diff-line-num">{{ line.newLine ?? line.oldLine ?? '' }}</span>
                <span class="git-diff-content" v-html="line.html"></span>
              </div>
            </template>
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
            <div class="git-tree-scroll">
        <template v-if="isGitRepo">
          <div v-for="group in displayGroups" :key="group.key">
            <div class="git-group-header">
              {{ group.label }} ({{ group.rows.length }})
            </div>
            <div v-for="trow in group.treeRows" :key="trow.key" class="git-tree-row"
              :class="{
                'git-tree-row--dir': trow.isDir,
                'git-tree-row--partial': !trow.isDir && !!trow.row?.isPartial,
                selected: !trow.isDir && selectedKey === trow.key,
              }"
              :style="{ paddingLeft: 8 + trow.depth * 14 + 'px', '--indent': trow.depth * 14 + 'px' }"
              @click="trow.isDir ? toggleDir(trow) : trow.row && selectRow(trow.row)">
              <template v-if="trow.isDir">
                <el-icon :size="12" class="git-tree-chevron"
                  :class="{ expanded: !collapsedDirs.has(trow.key) }">
                  <ArrowRight />
                </el-icon>
                <span class="git-tree-name" :title="trow.path">{{ trow.name }}</span>
              </template>
              <template v-else>
                <span class="git-status" :class="`git-status--${statusClass(trow.row!)}`">{{ trow.row!.statusChar }}</span>
                <span class="git-tree-name" :title="trow.row!.file.path">{{ trow.name }}</span>
                <span class="git-row-actions" @click.stop>
                  <button v-if="trow.row!.group === 'staged'" class="git-row-btn" :title="t('git.unstage')"
                    @click="unstageFile(trow.row!)">
                    <el-icon :size="12"><Remove /></el-icon>
                  </button>
                  <button v-else class="git-row-btn" :title="t('git.stage')" @click="stageFile(trow.row!)">
                    <el-icon :size="12"><Plus /></el-icon>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, reactive, onUnmounted } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useStorage } from "@vueuse/core";
import { Refresh, Plus, Remove, ArrowUp, ArrowRight, Close } from "@element-plus/icons-vue";
import { Branch20Regular, Search20Regular } from "@vicons/fluent";
import { LiteSplitpanes } from "../../ui";
import { apiService } from "@/services/ApiService";
import type { GitStatus, GitFileChange, GitBranch, GitDiff } from "@/services/modules/git.api";
import { useHighlight } from "@/composables/useHighlight";

const { t } = useI18n();
const { highlightCode, getLanguageFromExtension, escapeHtml } = useHighlight();

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

interface DiffLine {
  /** gap = hunk 之间的未修改行折叠条；binary = 二进制文件不支持预览 */
  type: "add" | "del" | "ctx" | "hunk" | "gap" | "binary";
  sign: string;
  html: string;
  /** gap 行：未修改的行数 */
  gap?: number;
  /** gap 行：新文件侧未修改的行数（split 视图右列条用） */
  newGap?: number;
  /** 旧文件行号（del/ctx 行），add 行与 hunk 行为空 */
  oldLine?: number;
  /** 新文件行号（add/ctx 行），del 行与 hunk 行为空 */
  newLine?: number;
}

interface DiffStats {
  add: number;
  del: number;
}

/**
 * 拆分视图（两列：旧文件 | 新文件）的扁平行。
 * 核心：del 行与 add 行**配对**成一行（type="pair"，左=旧右=新，VS Code 风格），
 * 保证左右两列行数一一对应；配不完的多余 del/add 单独成行（del-only/add-only）。
 * gap = hunk 间未修改行折叠条（可点击展开）；gap-close = 展开后的收起条。
 */
interface SplitDiffLine {
  type: "pair" | "del" | "add" | "ctx" | "gap" | "gap-close" | "binary" | "hunk";
  /** 旧文件行号（pair/del/ctx 行；gap 行 = 区间起点） */
  oldLine?: number;
  /** 新文件行号（pair/add/ctx 行；gap 行 = 新文件区间起点） */
  newLine?: number;
  /** 旧列内容（pair/del/ctx 行；add-only 行为空） */
  oldHtml: string;
  /** 新列内容（pair/add/ctx 行；del-only 行为空） */
  newHtml: string;
  /** gap/binary/hunk 跨两列占满行的内容 */
  html?: string;
  gap?: number;
  /** gap 行：新文件侧跳过的行数（split 视图右列条） */
  newGap?: number;
  /** 该行在解析层 splitLines 中的原始索引（gap/gap-close 展开状态 key，display 层设置） */
  srcIdx?: number;
}

/** display 层行：带解析层原始索引（gap 展开/收起用） */
interface DisplaySplitLine extends SplitDiffLine {
  srcIdx: number;
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
}

interface GitTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  row?: GitRow;
  children: GitTreeNode[];
}

/** 单文件 diff 行数上限，防止大文件拖垮渲染 */
const MAX_DIFF_LINES = 800;

const status = ref<GitStatus | null>(null);
const branches = ref<GitBranch[]>([]);
const selectedBranch = ref("");
const commitMessage = ref("");
const refreshing = ref(false);
const committing = ref(false);
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
 */
const diffSplitPct = computed(() => {
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

const isGitRepo = computed(() => status.value?.isGitRepo === true);
const totalChanges = computed(() => status.value?.files.length || 0);

/** 目录树搜索关键字 */
const searchText = ref("");

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

/** 按路径构建分组内的目录树（目录在前、按名称排序；叶子为文件行） */
function buildTree(rows: GitRow[]): GitTreeNode[] {
  const roots: GitTreeNode[] = [];
  const map = new Map<string, GitTreeNode>();
  for (const r of rows) {
    const parts = r.file.path.split("/");
    let cur = "";
    let parent = roots;
    for (let i = 0; i < parts.length; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      let node = map.get(cur);
      if (!node) {
        node = { name: parts[i], path: cur, isDir: i < parts.length - 1, children: [] };
        map.set(cur, node);
        parent.push(node);
      }
      if (i === parts.length - 1) node.row = r;
      parent = node.children;
    }
  }
  sortTree(roots);
  return roots;
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
      out.push({ key, path: n.path, name: n.name, depth, isDir: true });
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
      const pairs = Math.min(dels.length, adds.length);
      for (let k = 0; k < pairs; k++) {
        out.push({
          type: "pair",
          oldLine: dels[k].oldLine,
          oldHtml: dels[k].html,
          newLine: adds[k].newLine,
          newHtml: adds[k].html,
        });
      }
      for (let k = pairs; k < dels.length; k++) {
        out.push({ type: "del", oldLine: dels[k].oldLine, oldHtml: dels[k].html, newHtml: "" });
      }
      for (let k = pairs; k < adds.length; k++) {
        out.push({ type: "add", newLine: adds[k].newLine, newHtml: adds[k].html, oldHtml: "" });
      }
    } else if (l.type === "ctx") {
      out.push({ type: "ctx", oldLine: l.oldLine, newLine: l.newLine, oldHtml: l.html, newHtml: l.html });
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

/** 左列行类：pair/del 行旧列着红色 */
function splitOldClass(type: SplitDiffLine["type"]): string {
  return type === "pair" || type === "del" ? "git-diff-split--del" : "";
}

/** 右列行类：pair/add 行新列着绿色 */
function splitNewClass(type: SplitDiffLine["type"]): string {
  return type === "pair" || type === "add" ? "git-diff-split--add" : "";
}

/** binary 文件特判：整份 diff 只有一行提示，直接全宽显示（无需双列） */
const isBinarySplit = computed<boolean>(() => {
  const ls = splitLines.value;
  return ls.length === 1 && ls[0].type === "binary";
});

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

function isGapExpanded(srcIdx: number): boolean {
  return gapExpanded.value.has(srcIdx);
}

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
 * 行虚拟化（对齐 VS Code 性能）：只渲染可视区 ± buffer 的行，DOM 恒为可视行数。
 * 行高固定：普通行 20px（line-height），gap/gap-close 行 30px（.git-diff-gap padding 3+3 +
 * .git-diff-gap-inner padding 2+2 + line 20）——由本项目 CSS 决定，改 CSS 需同步。
 */
const ROW_H = 20;
const GAP_ROW_H = 30;
/** 可视区外上下各多渲染的行数（快速拖拽不闪空） */
const SPLIT_BUFFER_ROWS = 15;

/** 每行累计 top 与总高度（基于 display 层；gap 展开/收起自动重算） */
const rowMetrics = computed<{ tops: number[]; total: number }>(() => {
  const lines = displaySplitLines.value;
  const tops: number[] = [];
  let total = 0;
  for (const l of lines) {
    tops.push(total);
    total += l.type === "gap" || l.type === "gap-close" ? GAP_ROW_H : ROW_H;
  }
  return { tops, total };
});

/** 列视口高度（ResizeObserver 更新，避免每帧读 clientHeight 触发 layout） */
const viewH = ref(0);

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

/** 可视行范围 [start, end) */
const sliceRange = computed<[number, number]>(() => {
  const tops = rowMetrics.value.tops;
  if (!tops.length) return [0, 0];
  const off = vScroll.offset;
  const vh = viewH.value || 300;
  const start = lowerBound(tops, off - SPLIT_BUFFER_ROWS * ROW_H);
  const end = Math.min(lowerBound(tops, off + vh + SPLIT_BUFFER_ROWS * ROW_H) + 1, tops.length);
  return [start, end];
});

/** 可视行（带绝对行号索引，两列共用同一份，天然对齐） */
const splitSlice = computed<{ line: DisplaySplitLine; idx: number }[]>(() => {
  const [s, e] = sliceRange.value;
  return displaySplitLines.value.slice(s, e).map((line, i) => ({ line, idx: s + i }));
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
  const vh = viewH.value;
  const total = rowMetrics.value.total;
  const max = total - vh;
  vScroll.maxOffset = Math.max(0, max);
  if (max <= 0 || vh <= 0) {
    vScroll.visible = false;
    vScroll.offset = 0;
    return;
  }
  const thumbH = Math.max(24, (vh / total) * vh);
  vScroll.visible = true;
  vScroll.thumbHeight = thumbH;
  vScroll.thumbTop = Math.round((vScroll.offset / max) * (vh - thumbH));
}

/**
 * 统一设置两列纵向位置（拖滑块/点轨道/滚轮的唯一入口，保证永远同步）：
 * 直接 translateY 平移两列内容（不用 scrollTop），offset 是单一状态。
 * offset 必须圆整为整数像素：浮点 offset → translateY 亚像素平移 →
 * 非整数 DPI 缩放下行边界出现 1px 缝隙（概率性横线）。 */
function setColumnsOffset(offset: number): void {
  vScroll.offset = Math.round(clampOffset(offset));
  const t = `translateY(${-vScroll.offset}px)`;
  if (oldColInnerRef.value) oldColInnerRef.value.style.transform = t;
  if (newColInnerRef.value) newColInnerRef.value.style.transform = t;
  updateVScroll();
}

/** 列内滚轮：deltaY 累加 offset（阻止默认滚动，translate 是唯一纵向通道） */
function onColWheel(e: WheelEvent): void {
  e.preventDefault();
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16; // 行单位 → 像素
  setColumnsOffset(vScroll.offset + dy);
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
    // 直接改滑块位置 + 两列 transform，不调 updateVScroll（避免拖拽中 layout reflow）
    vScroll.thumbTop = top;
    const off = Math.round(ratio * vScroll.maxOffset); // 整数像素，避免亚像素横线
    vScroll.offset = off;
    const t = `translateY(${-off}px)`;
    if (oldColInnerRef.value) oldColInnerRef.value.style.transform = t;
    if (newColInnerRef.value) newColInnerRef.value.style.transform = t;
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

/** 内容/尺寸变化后刷新滚动条（选中切换、加载完成、窗口缩放） */
let vScrollResizeObserver: ResizeObserver | null = null;
watch(
  [oldColRef, newColRef, splitLines],
  () => {
    vScrollResizeObserver?.disconnect();
    const a = oldColRef.value;
    const b = newColRef.value;
    if (a && b) {
      vScrollResizeObserver = new ResizeObserver(() => {
        viewH.value = a.clientHeight;
        updateVScroll();
      });
      vScrollResizeObserver.observe(a);
      vScrollResizeObserver.observe(b);
    }
    void nextTick(updateVScroll);
  },
  { flush: "post" },
);

/** 切换选中文件：偏移复位到顶部、清空 gap 展开状态 */
watch(
  () => selectedKey.value,
  () => {
    vScroll.offset = 0;
    gapExpanded.value = new Set();
    gapRows.value = {};
  },
);

onUnmounted(() => {
  vScrollResizeObserver?.disconnect();
  vScrollResizeObserver = null;
  document.removeEventListener("mousemove", onThumbMove);
  document.removeEventListener("mouseup", onThumbUp);
  bodyResizeObserver?.disconnect();
  bodyResizeObserver = null;
});

function diffLineClass(type: DiffLine["type"]): string {
  return {
    add: "git-diff-add",
    del: "git-diff-del",
    hunk: "git-diff-hunk",
    ctx: "git-diff-ctx",
    gap: "git-diff-gap",
    binary: "git-diff-binary",
  }[type];
}

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

function highlightLine(line: string, lang: string): string {
  if (!line) return "&nbsp;";
  try {
    const highlighted = highlightCode(line, lang);
    const match = highlighted.match(/<div class="line-content">(.*?)<\/div>/s);
    if (match) return match[1];
    return escapeHtml(line);
  } catch {
    return escapeHtml(line);
  }
}

function parseUnifiedDiff(text: string, lang: string): DiffLine[] {
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
        html: highlightLine(raw.slice(1), lang),
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
        html: highlightLine(raw.slice(1), lang),
        oldLine: oldLineNum,
      });
      if (oldLineNum !== undefined) nextOldLine = ++oldLineNum;
    } else if (raw.startsWith(" ")) {
      result.push({
        type: "ctx",
        sign: " ",
        html: highlightLine(raw.slice(1), lang),
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

function renderDiff(res: GitDiff, filePath: string): DiffLine[] {
  const lang = getLanguage(filePath);

  // 二进制文件（图片等）：不渲染内容，只显示提示行
  if (res.binary) {
    return [
      { type: "binary", sign: "", html: escapeHtml(t("git.binaryNotPreview")) },
    ];
  }

  if (res.type === "new-file") {
    const lines = (res.content || "").split("\n");
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
      result.push({ type: "add", sign: "+", html: highlightLine(lines[i], lang), newLine: i + 1 });
    }
    return result;
  }

  return parseUnifiedDiff(res.diff || "", lang);
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
  diffLoadSeq++;
}

async function loadDiff(row: GitRow): Promise<void> {
  if (!props.sessionId) return;
  const key = rowKey(row);
  const seq = ++diffLoadSeq;
  loadingKey.value = key;
  try {
    const res = await apiService.getGitDiff(props.sessionId, row.file.path, row.group === "staged");
    const lines = renderDiff(res, row.file.path);
    // 加载期间选中被切换/清空时丢弃过期响应
    if (seq === diffLoadSeq && selectedKey.value === key) {
      diffLines.value = { [key]: lines };
    }
  } catch {
    if (seq === diffLoadSeq && selectedKey.value === key) {
      ElMessage.error(t("git.loadFailed"));
      diffLines.value = { [key]: [] };
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

/** 从后端读取 gap 区间的旧文件行（未修改行 = 旧文件/HEAD 或 index 版本的行），转为 ctx 行 */
async function loadGapRows(idx: number): Promise<void> {
  if (!props.sessionId || gapRows.value[idx]) return;
  const src = splitLines.value[idx];
  if (!src || src.type !== "gap" || src.oldLine === undefined || !src.gap) return;
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
    const lines: SplitDiffLine[] = res.content.split("\n").map((text, i) => {
      const html = highlightLine(text, lang);
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

async function refresh(): Promise<void> {
  if (!props.sessionId || refreshing.value) return;
  refreshing.value = true;
  // 刷新前记录当前选中文件路径：刷新后按路径保持选中（分组可能变化，diff 重新拉取）
  const prevPath = selectedRow.value?.file.path;
  try {
    const res = await apiService.getGitStatus(props.sessionId);
    status.value = res;
    if (res.branch) selectedBranch.value = res.branch;

    // 折叠状态修剪：仅保留仍存在的目录（refresh 只增不减，否则残留幽灵目录）
    const validDirs = new Set<string>();
    for (const g of groups.value) collectDirKeys(g.rows, g.key, validDirs);
    collapsedDirs.value = new Set([...collapsedDirs.value].filter((k) => validDirs.has(k)));

    // 选中保持：路径仍在变更列表中则按新分组重新加载；否则清空
    if (prevPath) {
      const f = res.files.find((ff) => ff.path === prevPath);
      if (f) {
        const c = classifyFile(f);
        selectedKey.value = `${c.group}:${f.path}`;
        diffLines.value = {};
        void loadDiff({ file: f, ...c });
      } else {
        clearSelection();
      }
    }

    if (res.isGitRepo) {
      const b = await apiService.getGitBranches(props.sessionId);
      branches.value = b.branches;
    } else {
      branches.value = [];
    }
  } catch {
    status.value = null;
    ElMessage.error(t("git.loadFailed"));
  } finally {
    refreshing.value = false;
  }
}

async function stageFile(row: GitRow): Promise<void> {
  if (!props.sessionId) return;
  try {
    await apiService.gitStage(props.sessionId, [row.file.path]);
    await refresh();
  } catch {
    ElMessage.error(t("git.stageFailed"));
  }
}

async function unstageFile(row: GitRow): Promise<void> {
  if (!props.sessionId) return;
  try {
    await apiService.gitUnstage(props.sessionId, [row.file.path]);
    await refresh();
  } catch {
    ElMessage.error(t("git.unstageFailed"));
  }
}

async function handleStageAll(): Promise<void> {
  if (!props.sessionId) return;
  try {
    await apiService.gitStage(props.sessionId);
    await refresh();
  } catch {
    ElMessage.error(t("git.stageFailed"));
  }
}

async function onBranchChange(branch: string): Promise<void> {
  const prev = status.value?.branch || selectedBranch.value;
  if (!props.sessionId || !branch) return;
  try {
    await apiService.gitCheckout(props.sessionId, branch);
    ElMessage.success(t("git.checkoutSuccess", { branch }));
    clearSelection();
  } catch (e: any) {
    ElMessage.error(t("git.checkoutFailed", { msg: e?.message || "" }));
    selectedBranch.value = prev;
  }
  await refresh();
}

async function handleCommit(): Promise<void> {
  const message = commitMessage.value.trim();
  if (!message || !props.sessionId || committing.value) return;
  committing.value = true;
  try {
    const st = status.value;
    const stagedCount =
      st?.files.filter((f) => f.index.trim() && f.index.trim() !== "?").length || 0;
    // 无暂存内容时自动全部暂存再提交（VS Code「全部提交」语义）
    if (stagedCount === 0) {
      await apiService.gitStage(props.sessionId);
    }
    await apiService.gitCommit(props.sessionId, message);
    ElMessage.success(t("git.commitSuccess"));
    commitMessage.value = "";
    clearSelection();
    await refresh();
  } catch (e: any) {
    ElMessage.error(t("git.commitFailed", { msg: e?.message || "" }));
    await refresh();
  } finally {
    committing.value = false;
  }
}

watch(
  () => props.sessionId,
  () => {
    status.value = null;
    branches.value = [];
    selectedBranch.value = "";
    commitMessage.value = "";
    clearSelection();
    collapsedDirs.value = new Set();
    if (props.sessionId) void refresh();
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
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.git-tool-btn:hover:not(:disabled) {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.git-tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.git-tool-btn .is-loading {
  animation: git-spin 1s linear infinite;
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
  color: var(--el-text-color-secondary);
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
   （两列同一 offset，永远同步）；min-width:100% 保证内容短时背景铺满 */
.git-diff-split-col-inner {
  position: relative;
  min-width: 100%;
  will-change: transform;
}

/* 虚拟化行：绝对定位在 rowMetrics.tops[idx]，高度固定（普通 20px / gap 30px） */
.git-diff-split-row {
  position: absolute;
  left: 0;
  right: 0;
}

.git-diff-split-col-divider {
  flex-shrink: 0;
  width: 1px;
  background: var(--el-border-color-lighter);
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
  background: var(--el-border-color);
  cursor: pointer;
  transition: background 0.15s ease;
}

.git-diff-vscroll-thumb:hover,
/* 拖拽中强制保持高亮（鼠标离开滑块也不消失，原生滚动条行为） */
.git-diff-vscroll-thumb.dragging,
/* 轨道聚焦时滑块提亮（键盘可操作指示） */
.git-diff-vscroll.focused .git-diff-vscroll-thumb {
  background: var(--el-text-color-placeholder);
}

/* 拖拽遮罩：全屏，阻止其他元素响应（原生滚动条拖拽时鼠标捕获，其他元素不响应） */
.git-diff-vscroll-mask {
  position: fixed;
  inset: 0;
  z-index: 99999;
  cursor: grabbing;
}

/* 单行：行号 + 内容 */
.git-diff-split-line {
  display: flex;
  align-items: stretch;
}

/* 行号两列都钉各自左缘（VS Code 风格）：左列行号贴容器左、右列行号贴中间分隔线，
   列内横向滚动时行号固定遮挡滑过的内容（基础样式已含 sticky left:0 + 背景色右边） */

/* add 行：整行淡绿底 + 新列行号左缘绿色实线竖条 */
.git-diff-split-line.git-diff-split--add {
  --diff-bg: color-mix(in srgb, #2da44e 8%, var(--color-bg));
  background: var(--diff-bg);
}
.git-diff-split-col--new .git-diff-split-line.git-diff-split--add .git-diff-line-num {
  background: var(--diff-bg);
  box-shadow: inset 3px 0 0 #2da44e;
  color: #1a7f37;
}
.git-diff-split-col--old .git-diff-split-line.git-diff-split--add .git-diff-line-num {
  background: var(--diff-bg);
}

/* del 行：整行淡红底 + 旧列行号左缘红色虚线状指示条（同 unified 公式） */
.git-diff-split-line.git-diff-split--del {
  --diff-bg: color-mix(in srgb, #cf222e 6%, var(--color-bg));
  background: var(--diff-bg);
}
.git-diff-split-col--old .git-diff-split-line.git-diff-split--del .git-diff-line-num {
  background: var(--diff-bg);
  color: #cf222e;
}
.git-diff-split-col--old .git-diff-split-line.git-diff-split--del .git-diff-line-num::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background-image: linear-gradient(0deg, rgba(207, 34, 46, 0.55) 50%, var(--diff-bg) 50%);
  background-repeat: repeat;
  background-size: 100% var(--stripe-size);
}
.git-diff-split-col--new .git-diff-split-line.git-diff-split--del .git-diff-line-num {
  background: var(--diff-bg);
}

html.dark .git-diff-split-line.git-diff-split--add {
  --diff-bg: color-mix(in srgb, #3fb950 12%, var(--color-bg));
}
html.dark .git-diff-split-line.git-diff-split--del {
  --diff-bg: color-mix(in srgb, #f85149 10%, var(--color-bg));
}
html.dark .git-diff-split-col--new .git-diff-split-line.git-diff-split--add .git-diff-line-num {
  box-shadow: inset 3px 0 0 #3fb950;
  color: #3fb950;
}
html.dark .git-diff-split-col--old .git-diff-split-line.git-diff-split--del .git-diff-line-num {
  color: #f85149;
}
html.dark .git-diff-split-col--old .git-diff-split-line.git-diff-split--del .git-diff-line-num::before {
  background-image: linear-gradient(0deg, rgba(248, 81, 73, 0.6) 50%, var(--diff-bg) 50%);
}

/* ── 拆分视图 ── */
.git-diff-view-toggle {
  display: flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
}

.git-diff-view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.git-diff-view-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.git-diff-view-btn.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

/* ── 右栏：变更文件目录树 ── */
.git-body {
  border-top: 1px solid var(--el-border-color-lighter);
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
  color: var(--el-text-color-placeholder);
}

.git-tree-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--el-text-color-primary);
}

.git-tree-search-input::placeholder {
  color: var(--el-text-color-placeholder);
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
  color: var(--el-text-color-placeholder);
  cursor: pointer;
  flex-shrink: 0;
}

.git-tree-search-clear:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
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
    var(--el-border-color-lighter) 6px 7px,
    transparent 7px 14px
  );
  pointer-events: none;
}

.git-tree-row:hover {
  /* 与全局侧边栏 hover 一致（--color-sidebar-bg-hover：浅色 rgba(40,5,5,0.05) 微透明，暗色 #2f3131） */
  background: var(--color-sidebar-bg-hover);
}

.git-tree-row--dir {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.git-tree-row--partial .git-tree-name {
  color: var(--el-color-warning);
}

/* 选中行：与 hover 同一颜色（--color-sidebar-bg-hover，微透明），不加深 */
.git-tree-row.selected {
  background: var(--color-sidebar-bg-hover);
}

.git-tree-chevron {
  flex-shrink: 0;
  color: var(--el-text-color-placeholder);
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
  color: var(--el-text-color-primary);
}

.git-status {
  width: 18px;
  text-align: center;
  font-family: var(--font-mono, "SF Mono", Consolas, monospace);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.git-status--modified { color: var(--el-color-warning); }
.git-status--added { color: var(--el-color-success); }
.git-status--deleted { color: var(--el-color-danger); }
.git-status--renamed { color: var(--el-color-primary); }
.git-status--conflict { color: var(--el-color-danger); }

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
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.git-row-btn:hover {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-primary);
}

/* ── 左栏：diff 预览 ── */
.git-diff-pane {
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;
}

/* 拆分视图：pane 不再滚动（两列各自滚动），header 固定在上方，split 区域填满剩余空间 */
.git-diff-pane--split {
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.git-diff-pane--split .git-diff-split {
  flex: 1;
  min-height: 0;
}

.git-diff-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  user-select: none;
}

/* 文件头：随左侧滚动吸顶（背景用面板背景色 --color-bg，不透明吸顶不透内容；无底部边框线） */
.git-diff-header {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 上下边距加大 */
  padding: 10px 12px;
  position: sticky;
  top: 0;
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
  color: var(--el-text-color-primary);
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
  color: var(--el-text-color-secondary);
  cursor: pointer;
  flex-shrink: 0;
  /* 固定在标题栏最右端 */
  margin-left: auto;
}

.git-diff-close:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
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
  color: var(--el-text-color-placeholder);
}

/* 字体与行高 unified/split 共享（拆出行号大小不一致的根源：
   table 与 split 都必须 12px/20px，否则 split 列继承 pane 大字号） */
.git-diff-table,
.git-diff-split {
  font-family: var(--font-mono, "SF Mono", Consolas, "Courier New", monospace);
  font-size: 12px;
  /* 整数行高（20px）：--stripe-size 公式得出整数周期 2px，行高 ÷ 周期 = 10 整除，
     每行恰好整数个条纹周期，行间虚线相位精确对齐；
     若用 1.6 × 12px = 19.2px 小数行高，浏览器瓦片化会把 1.92px 周期
     吸附成 2px，每行末尾残留半周期 → 每隔一行出现异常间距（不连续） */
  line-height: 20px;
}

.git-diff-table {
  /* 宽度跟随内容：短行时 = 容器宽（min-width:100% 保证背景铺满，无滚动条），
     超长行时 = 内容宽（出现横向滚动条，行号 sticky 固定） */
  width: max-content;
  min-width: 100%;
}

/* 单行：flex 结构（参考 FilePreviewPanel 代码预览），行号 sticky 性能优于 table-cell */
.git-diff-line {
  display: flex;
  align-items: stretch;
}

.git-diff-line-num {
  /* 固定宽度使 text-align: right 生效：不同位数行号右对齐（个位对齐），
     数字左侧留出空白 */
  flex: 0 0 48px;
  width: 48px;
  padding: 0 12px 0 4px;
  text-align: right;
  user-select: none;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-placeholder);
  /* 横向滚动时行号固定钉在左侧 */
  position: sticky;
  left: 0;
  z-index: 1;
  /* 项目主题变量（style.css --color-bg，跟随主题切换） */
  background-color: var(--color-bg);
  /* 右缘分隔线用背景色 2px：普通行同色不可见；add/del 彩色行上呈现
     面板背景色竖条，把行号区与彩色内容区分开（sticky 滚动时遮住滑过的内容） */
  border-right: 2px solid var(--color-bg);
  /* 条纹周期：1lh（20px）量化成 2px 整数倍 → 整数周期 2px，
     每行 10 个整周期、行间虚线相位对齐（参考项目 bars 指示器公式） */
  --stripe-size: calc(1lh * (1 / round(1lh * (1 / 2px))));
}

.git-diff-content {
  /* 绝不自动换行（white-space: pre）：短行单行显示，超长行撑宽表格由容器横向滚动；
     flex:1 + min-width:0 使内容短时填满容器（背景铺满整行），长时跟随内容宽度 */
  white-space: pre;
  flex: 1;
  min-width: 0;
  padding: 0 12px 0 8px;
  color: var(--el-text-color-primary);
}

/* ── 新增/删除行：不透明背景（color-mix 混合纯色，滚动时内容不会从行号下透出） ── */

/* 新增行：整行淡绿底 + 行号左侧绿色实线竖条（不做虚线处理） */
.git-diff-line.git-diff-add {
  /* 基色用项目主题变量 --color-bg（不是 Element Plus 的 --el-bg-color） */
  --diff-bg: color-mix(in srgb, #2da44e 8%, var(--color-bg));
  background: var(--diff-bg);
}
.git-diff-line.git-diff-add .git-diff-line-num {
  background: var(--diff-bg);
  box-shadow: inset 3px 0 0 #2da44e;
  color: #1a7f37;
}

/* 删除行：整行淡红底 + 行号左缘红色虚线状指示条。
   虚线不是 border:dashed，而是 ::before 窄条上铺 0deg 渐变细条纹：
   每个周期下半段为红色（虚线色块）、上半段为行底色（空隙），
   background-size 用 --stripe-size（1lh 量化到 2px 整数倍）保证每行
   整数个周期、行间虚线相位对齐（参考项目 bars 指示器实现）。 */
.git-diff-line.git-diff-del {
  --diff-bg: color-mix(in srgb, #cf222e 6%, var(--color-bg));
  background: var(--diff-bg);
}
.git-diff-line.git-diff-del .git-diff-line-num {
  background: var(--diff-bg);
  color: #cf222e;
}
.git-diff-line.git-diff-del .git-diff-line-num::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background-image: linear-gradient(0deg, rgba(207, 34, 46, 0.55) 50%, var(--diff-bg) 50%);
  background-repeat: repeat;
  background-size: 100% var(--stripe-size);
}

html.dark .git-diff-line.git-diff-add {
  --diff-bg: color-mix(in srgb, #3fb950 12%, var(--color-bg));
}
html.dark .git-diff-line.git-diff-del {
  --diff-bg: color-mix(in srgb, #f85149 10%, var(--color-bg));
}
html.dark .git-diff-line.git-diff-add .git-diff-line-num {
  box-shadow: inset 3px 0 0 #3fb950;
  color: #3fb950;
}
html.dark .git-diff-line.git-diff-del .git-diff-line-num {
  color: #f85149;
}
html.dark .git-diff-line.git-diff-del .git-diff-line-num::before {
  background-image: linear-gradient(0deg, rgba(248, 81, 73, 0.6) 50%, var(--diff-bg) 50%);
}

/* hunk 头兜底样式（解析失败时） */
.git-diff-line.git-diff-hunk {
  background: var(--el-fill-color-light);
}
.git-diff-line.git-diff-hunk .git-diff-line-num {
  background: var(--el-fill-color-light);
}
.git-diff-line.git-diff-hunk .git-diff-content {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

/* 二进制文件提示行（图片等不支持文本预览） */
.git-diff-line.git-diff-binary {
  padding: 6px 0;
}
.git-diff-line.git-diff-binary .git-diff-content {
  font-family: var(--font-sans, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 12px;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: default;
  user-select: none;
}

/* 「N 行未修改」折叠条（替代 @@ hunk 头）：占满整行，不缩进行号列 */
.git-diff-line.git-diff-gap {
  padding: 3px 8px 3px 3px;
}

.git-diff-gap-inner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-family: var(--font-sans, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 11px;
  user-select: none;
}

.git-diff-gap-icon {
  color: var(--el-text-color-placeholder);
  flex-shrink: 0;
}

/* 可点击展开的折叠条（对齐 GitHub/VS Code）：hover 加深 + 手型 */
.git-diff-gap-click {
  cursor: pointer;
}

.git-diff-gap-click:hover .git-diff-gap-inner {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.git-diff-gap-click:hover .git-diff-gap-icon {
  color: var(--el-text-color-secondary);
}

.git-diff-gap-click.expanded .git-diff-gap-icon {
  transform: rotate(90deg);
}
</style>
