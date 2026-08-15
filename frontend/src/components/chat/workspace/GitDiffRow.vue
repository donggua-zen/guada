<template>
  <!-- gap / gap-close：未修改行折叠条（点击展开/收起；unified 与 split 两列共用） -->
  <div
    v-if="line.type === 'gap' || line.type === 'gap-close'"
    class="git-diff-line git-diff-gap git-diff-vrow git-diff-gap-click"
    :class="{ expanded: line.type === 'gap-close' }"
    :style="{ top: top + 'px' }"
    :title="line.type === 'gap' ? t('git.expandUnmodified') : t('git.collapseUnmodified')"
    @click="emit('toggle', line)"
  >
    <div class="git-diff-gap-inner">
      <!-- 收起态（gap）：→ 可展开；展开态（gap-close）：→ 旋转 90° = ↓ 可收起（对齐文件树惯例） -->
      <el-icon :size="11" class="git-diff-gap-icon"><ArrowRight /></el-icon>
      <span>{{ gapText }}</span>
    </div>
  </div>
  <!-- binary 文件提示行（整份只有一行；自然流全宽显示，不参与虚拟化定位） -->
  <div v-else-if="line.type === 'binary'" class="git-diff-line git-diff-binary">
    <span class="git-diff-content" v-html="line.html"></span>
  </div>
  <!-- hunk 头（@@ 解析失败的兜底行） -->
  <div
    v-else-if="line.type === 'hunk'"
    class="git-diff-line git-diff-hunk git-diff-vrow"
    :style="{ top: top + 'px' }"
  >
    <span class="git-diff-content" v-html="line.html"></span>
  </div>
  <!-- 代码行：行号 + 内容（variant 由行类型 × 视图侧推导，见 variantClass） -->
  <div v-else class="git-diff-line git-diff-vrow" :class="variantClass" :style="{ top: top + 'px' }">
    <span class="git-diff-line-num">{{ lineNum }}</span>
    <!-- 空内容必须 &nbsp; 兜底：空 span 无行盒 → 行高塌缩为 0（左右列/相邻行错位）；
         空侧占位（浅灰斜线纹理）由 variantClass 的 git-diff-placeholder 提供 -->
    <span class="git-diff-content" v-html="contentHtml"></span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowRight } from "@element-plus/icons-vue";
import type { DisplaySplitLine } from "./git-diff-types";

/** 渲染侧：old=split 旧列 | new=split 新列 | uni=unified 单列 */
export type DiffRowSide = "old" | "new" | "uni";

const { t } = useI18n();

const props = defineProps<{
  line: DisplaySplitLine;
  side: DiffRowSide;
  /** 虚拟化绝对定位 top（px）；binary 行自然流渲染，该值无影响 */
  top: number;
}>();

const emit = defineEmits<{
  toggle: [line: DisplaySplitLine];
}>();

/** 行号：split 各列显本侧行号；uni 按行类型取（del→旧行号，add→新行号，ctx→优先新） */
const lineNum = computed(() => {
  const l = props.line;
  if (props.side === "old") return l.oldLine ?? "";
  if (props.side === "new") return l.newLine ?? "";
  if (l.type === "del") return l.oldLine ?? "";
  if (l.type === "add") return l.newLine ?? "";
  return l.newLine ?? l.oldLine ?? "";
});

/** 内容：split 各列取本侧高亮；uni 按行类型取（del→旧侧，add→新侧，ctx→优先新侧） */
const contentHtml = computed(() => {
  const l = props.line;
  let html: string | undefined;
  if (props.side === "old") html = l.oldHtml;
  else if (props.side === "new") html = l.newHtml;
  else if (l.type === "del") html = l.oldHtml;
  else if (l.type === "add") html = l.newHtml;
  else html = l.newHtml || l.oldHtml;
  return html || "&nbsp;";
});

/**
 * 行 variant：「行类型 × 视图侧」的唯一推导处（unified 单列 / split 两列统一）：
 * - uni：del→删除红，add→新增绿（pair 已在 displayUnifiedLines 展开成 del/add 行）；
 * - split 旧列：pair/del→删除红；add→placeholder（空侧斜线占位纹理）；
 * - split 新列：pair/add→新增绿；del→placeholder。
 * 每列的 variant 与其内容天然同侧 → 着色 CSS 无需列上下文选择器，全视图共用一套。
 */
const variantClass = computed(() => {
  const t = props.line.type;
  if (props.side === "uni") {
    return t === "del" ? "git-diff-del" : t === "add" ? "git-diff-add" : "";
  }
  if (props.side === "old") {
    return t === "pair" || t === "del"
      ? "git-diff-del"
      : t === "add"
        ? "git-diff-placeholder"
        : "";
  }
  return t === "pair" || t === "add"
    ? "git-diff-add"
    : t === "del"
      ? "git-diff-placeholder"
      : "";
});

/** gap 条文案：new 侧用新文件口径行数（newGap）；gap-close 追加「· 收起」 */
const gapText = computed(() => {
  const l = props.line;
  const count = props.side === "new" ? (l.newGap ?? l.gap ?? 0) : (l.gap ?? 0);
  const base = t("git.unmodifiedLines", { count });
  return l.type === "gap-close" ? `${base} · ${t("git.collapse")}` : base;
});
</script>

<style scoped>
/* ── 行渲染样式：unified 单列与 split 两列共用（行组件唯一持有） ── */

/* 虚拟化行：绝对定位（top 由父组件按行号索引计算）。
   行宽 = max(内容宽, 容器宽)：width:max-content + min-width:100% ——
   容器（split 列 inner / unified table）被宽度锚层撑为 max(所有行内容宽, 100%)，
   → add/del 高亮背景铺满整行（横向滚动右侧不丢背景） */
.git-diff-vrow {
  position: absolute;
  left: 0;
  width: max-content;
  min-width: 100%;
}

/* 单行：行号 + 内容（flex 结构，行号 sticky 性能优于 table-cell） */
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
  /* 横向滚动时行号固定钉在左侧（split 列内 / unified 表内同样生效） */
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
  /* 绝不自动换行（white-space: pre）：短行单行显示，超长行撑宽容器由外层横向滚动；
     flex:1 + min-width:max-content 使内容短时填满容器（背景铺满整行），
     长时 span 自身跟随文本宽度（背景天然铺满内容，横向滚动后不截断） */
  white-space: pre;
  flex: 1;
  min-width: max-content;
  padding: 0 12px 0 8px;
  color: var(--el-text-color-primary);
}

/* ── 新增/删除行：不透明背景（color-mix 混合纯色，滚动时内容不会从行号下透出）。
   variant 与内容天然同侧（见 variantClass），无需列上下文选择器 ── */

/* 新增行：整行淡绿底 + 行号左侧绿色实线竖条（不做虚线处理）。
   背景同时铺在行 div（可视区兜底）与内容 span（跟随文本宽度 → 横向滚动后不截断） */
.git-diff-line.git-diff-add {
  /* 基色用项目主题变量 --color-bg（不是 Element Plus 的 --el-bg-color） */
  --diff-bg: color-mix(in srgb, #2da44e 8%, var(--color-bg));
  background: var(--diff-bg);
}
.git-diff-line.git-diff-add .git-diff-content {
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
.git-diff-line.git-diff-del .git-diff-content {
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

/* 纯占位列（add-only 旧列 / del-only 新列的空内容行）：浅灰斜线纹理，
   不是纯空白（对齐 VS Code 等平台 diff 空侧列样式）。与 gap 条同方案
   （repeating-linear-gradient，明/暗主题自适应）：placeholder 色 8% 浅灰底
   + 25% 斜线，行号区与内容区一体（整行连贯）。 */
.git-diff-line.git-diff-placeholder .git-diff-line-num {
  background: color-mix(in srgb, var(--el-text-color-placeholder) 8%, var(--color-bg));
}
.git-diff-line.git-diff-placeholder .git-diff-content {
  background:
    repeating-linear-gradient(
      -45deg,
      transparent 0 5.6569px,
      color-mix(in srgb, var(--el-text-color-placeholder) 25%, transparent) 5.6569px 7.0711px
    ),
    color-mix(in srgb, var(--el-text-color-placeholder) 8%, var(--color-bg));
  /* 细斜线 + 相位对齐：-45° 斜向渐变必须按「垂直投影周期」整除 tile 高 ——
     轴周期 7.0711px（= 10px/√2）的垂直投影恰好 10px，tile 高 20px = 2 个整周期，
     行与行之间斜线无缝衔接；条纹轴宽 1.4142px → 实际厚度 = 1.4142px × cos45° = 1px。
     （改周期必须保持「轴周期 × √2」整除 20px，否则行间纹理断裂错位） */
  background-size: 100% 20px;
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
  /* 横向滚动时条钉在视口左缘不跟随内容（行宽已被虚拟化定位撑满整行） */
  position: sticky;
  left: 8px;
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

/* 展开态（gap-close）：向右箭头旋转 90° 变为向下（对齐文件树 chevron 惯例） */
.git-diff-gap-click.expanded .git-diff-gap-icon {
  transform: rotate(90deg);
}
</style>
