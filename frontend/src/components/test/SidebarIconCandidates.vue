<!--
  临时页面：侧边栏「移动访问」图标候选对比（仅用于选型，选定后可删除本文件与 /icon-candidates 路由）

  背景：侧边栏底部两个入口图标风格不一致
    - 移动访问：Phone16Regular（1px 细线框）
    - 设置：    Settings16Filled（实心块面）
  目标：在 @vicons/fluent 同族里找重量、语义都更搭的候选；都没有再考虑自绘 16px 网格图标。

  【结论】已采纳「反向方案」：设置改为 Settings16Regular，与移动入口同为线框。
  侧边栏其余导航图标（Bot/Apps/PuzzlePiece/Weather 等）本就是 Regular，整条栏回到纯线框。
  本页保留作对比留档，确认无误后可连同 /icon-candidates 路由一起删除。
-->
<template>
  <div class="pick-page">
    <header class="head">
      <h2>侧边栏「移动访问」图标候选</h2>
      <p class="adopted">
        ✅ 已采纳：<b>设置降为线框</b>（<code>Settings16Filled</code> → <code>Settings16Regular</code>），
        移动入口保持 <code>Phone16Regular</code>。整条侧边栏统一为线框风格。本页留作对比留档。
      </p>
      <p class="sub">
        原始问题：<code>Phone16Regular</code>（细线框）vs <code>Settings16Filled</code>（实心）——重量差是违和主因。
        下面每个候选右侧固定并排 <code>Settings16Regular</code>（新基准），方便比对重量是否和谐。
      </p>
    </header>

    <!-- ── 改动前：还原截图那一行 ── -->
    <section class="block">
      <h3 class="block-title">改动前（截图还原 · 违和原因）</h3>
      <div class="preview-grid">
        <div v-for="theme in ['light', 'dark']" :key="theme" class="preview" :class="theme">
          <div class="preview-label">{{ theme === 'light' ? '浅色' : '深色' }}</div>
          <div class="preview-body">
            <div class="group-row">
              <svg class="folder" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M1 4.5A1.5 1.5 0 0 1 2.5 3h2.7c.4 0 .78.16 1.06.44L7.5 4.7h6A1.5 1.5 0 0 1 15 6.2v5.3A1.5 1.5 0 0 1 13.5 13h-11A1.5 1.5 0 0 1 1 11.5v-7z"
                  fill="none" stroke="#f8719a" stroke-width="1.2" />
              </svg>
              <span class="group-name">game</span>
            </div>
            <div class="user-row">
              <span class="avatar"></span>
              <span class="user-name">管理员</span>
              <div class="actions">
                <span class="hit" title="移动访问（Phone16Regular）">
                  <component :is="Phone16Regular" class="ico" />
                  <span class="dot"></span>
                </span>
                <span class="hit hit--active" title="设置（改动前 Settings16Filled）">
                  <component :is="Settings16Filled" class="ico" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 候选网格 ── -->
    <section class="block">
      <h3 class="block-title">若仍想换成实心（候选 · 4× 放大 + 1:1 实际尺寸）</h3>
      <div class="cards">
        <div v-for="(c, i) in candidates" :key="c.name" class="card" :class="{ picked: pickedIndex === i }"
          @click="pickedIndex = i">
          <div class="card-head">
            <span class="card-name">{{ c.name }}</span>
            <span v-if="c.recommended" class="badge badge--rec">推荐</span>
            <span class="badge badge--size">{{ c.px }}px</span>
          </div>
          <p class="card-desc">{{ c.desc }}</p>

          <div class="card-body">
            <!-- 放大看形状 -->
            <div class="zoom">
              <component :is="c.icon" class="zoom-ico" />
            </div>

            <!-- 1:1 实际尺寸对照 -->
            <div class="pairs">
              <div v-for="theme in ['light', 'dark']" :key="theme" class="pair" :class="theme">
                <span class="pair-tag">{{ theme === 'light' ? '浅' : '深' }}</span>
                <span class="hit hit--active">
                  <component :is="c.icon" class="ico" :style="iconStyle(c)" />
                </span>
                <component :is="Settings16Regular" class="ico ico--ref" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 已采纳方案 ── -->
    <section class="block">
      <h3 class="block-title">✅ 已采纳：把「设置」降为线框（不改移动图标）</h3>
      <p class="sub sub--tight">
        不改移动图标，只把设置从 <code>Settings16Filled</code> 换成 <code>Settings16Regular</code>。
        与侧边栏其余导航图标（<code>Bot20Regular</code> / <code>Apps20Regular</code> / <code>PuzzlePiece20Regular</code> 等）一致，
        整条栏统一为线框。改动位置：<code>GlobalSidebar.vue</code> 第 268 行（下拉菜单项）与第 291 行（底部按钮）。
      </p>
      <div class="preview-grid">
        <div v-for="theme in ['light', 'dark']" :key="theme" class="preview" :class="theme">
          <div class="preview-label">{{ theme === 'light' ? '浅色' : '深色' }} · 线上现况（两个都线框）</div>
          <div class="preview-body">
            <div class="user-row">
              <span class="avatar"></span>
              <span class="user-name">管理员</span>
              <div class="actions">
                <span class="hit">
                  <component :is="Phone16Regular" class="ico" />
                  <span class="dot"></span>
                </span>
                <span class="hit hit--active">
                  <component :is="Settings16Regular" class="ico" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 视觉尺寸备注 ── -->
    <section class="block note-block">
      <h3 class="block-title">落地注意（已采纳方案）</h3>
      <ul class="notes">
        <li>
          <b>光学大小</b>：<code>Settings16Regular</code> 的外圈与 Filled 同为 2→14，但笔画为线框、且内圈镂空，
          视觉上比手机（机身宽 8/16）略"空"，线框风格下属于正常波动，无需缩放。
        </li>
        <li>
          <b>尺寸档</b>：若后续想改用 <code>QrCode</code>（只有 20/24 档），按项目约定需把容器从
          <code>w-4 h-4</code> 改成 <code>w-5 h-5</code>，会连带影响点击区尺寸。
        </li>
      </ul>
    </section>

    <!-- ── 选定结果 ── -->
    <section v-if="picked" class="block picked-block">
      <h3 class="block-title">备用参照：{{ picked.name }}</h3>
      <div class="preview-grid">
        <div v-for="theme in ['light', 'dark']" :key="theme" class="preview" :class="theme">
          <div class="preview-label">{{ theme === 'light' ? '浅色' : '深色' }}</div>
          <div class="preview-body">
            <div class="user-row">
              <span class="avatar"></span>
              <span class="user-name">管理员</span>
              <div class="actions">
                <span class="hit">
                  <component :is="picked.icon" class="ico" :style="iconStyle(picked)" />
                  <span class="dot"></span>
                </span>
                <span class="hit hit--active">
                  <component :is="Settings16Regular" class="ico" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <pre class="snippet">{{ snippet }}</pre>
      <p class="hint">
        仅当你想改用实心方案时的参考代码。当前线上走的是线框方案，此处无需改动。
        改动点：<code>frontend/src/components/GlobalSidebar.vue</code> 第 281 行。
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  // 现状（Settings16Filled 仅用于"改动前"还原对比）
  Phone16Regular,
  Settings16Filled,
  Settings16Regular,
  // 候选
  Phone16Filled,
  PhoneDesktop16Filled,
  PhoneLaptop16Filled,
  PhoneCheckmark16Filled,
  Tablet16Filled,
  ShareScreenPerson16Filled,
  ShareScreenPersonOverlay16Filled,
  ShareScreenPersonOverlayInside16Filled,
  Remote16Filled,
  PhoneSpanIn16Regular,
  QrCode20Filled,
  QrCode20Regular,
  Cast20Regular,
  CellularData120Regular,
} from '@vicons/fluent'

interface Candidate {
  name: string
  icon: unknown
  px: number
  desc: string
  recommended?: boolean
}

// 不动的话就是普通数组（不放进 reactive，避免组件对象被代理）
const candidates: Candidate[] = [
  {
    name: 'Phone16Filled',
    icon: Phone16Filled,
    px: 16,
    desc: '实心手机，与设置的块面重量天然一致；只改填充态，语义不变，风险最低。',
    recommended: true,
  },
  {
    name: 'PhoneDesktop16Filled',
    icon: PhoneDesktop16Filled,
    px: 16,
    desc: '手机 + 桌面显示器：直接表达"手机连到这台电脑"，语义最贴切，也是实心。',
    recommended: true,
  },
  {
    name: 'PhoneCheckmark16Filled',
    icon: PhoneCheckmark16Filled,
    px: 16,
    desc: '手机 + 对勾，实心。暗示"已连接/已配对"，但右上角已有一颗绿点表示激活态，语义略重复。',
  },
  {
    name: 'PhoneLaptop16Filled',
    icon: PhoneLaptop16Filled,
    px: 16,
    desc: '手机 + 笔记本，实心。语义接近 PhoneDesktop，但笔记本造型在 16px 下细节更碎。',
  },
  {
    name: 'ShareScreenPerson16Filled',
    icon: ShareScreenPerson16Filled,
    px: 16,
    desc: '屏幕 + 人像，实心，取"别人远程操作这台机器"之意；信息量偏大，16px 下略糊。',
  },
  {
    name: 'ShareScreenPersonOverlay16Filled',
    icon: ShareScreenPersonOverlay16Filled,
    px: 16,
    desc: '同上变体（人像压在屏幕右下），实心；同样偏复杂。',
  },
  {
    name: 'ShareScreenPersonOverlayInside16Filled',
    icon: ShareScreenPersonOverlayInside16Filled,
    px: 16,
    desc: '屏幕内嵌人像，实心；比上一个更居中，缩到 16px 后仍显拥挤。',
  },
  {
    name: 'Tablet16Filled',
    icon: Tablet16Filled,
    px: 16,
    desc: '实心平板。重量最接近设置，但会被读成"平板"而非手机访问。',
  },
  {
    name: 'Remote16Filled',
    icon: Remote16Filled,
    px: 16,
    desc: '实心对向箭头，抽象表达"远程"；寓意弱，容易被当成"全屏/展开"按钮。',
  },
  {
    name: 'PhoneSpanIn16Regular',
    icon: PhoneSpanIn16Regular,
    px: 16,
    desc: '箭头向手机内收，语义"接入"很准；但仍是线框，重量问题没解决，仅作参照。',
  },
  {
    name: 'QrCode20Filled',
    icon: QrCode20Filled,
    px: 20,
    desc: '实心二维码——弹窗本体就是扫码配对，指向性极强。注意只有 20/24px 档，需按 20px 渲染。',
    recommended: true,
  },
  {
    name: 'QrCode20Regular',
    icon: QrCode20Regular,
    px: 20,
    desc: '线框二维码（20px 档），重量仍轻，列出仅作对照。',
  },
  {
    name: 'Cast20Regular',
    icon: Cast20Regular,
    px: 20,
    desc: '投屏（20px 档且为线框），风格与设置不符，仅作对照。',
  },
  {
    name: 'CellularData120Regular',
    icon: CellularData120Regular,
    px: 20,
    desc: '信号条（20px 档），极简但只有线条；寓意"移动网络"，不指向扫码入口。',
  },
]

const pickedIndex = ref(0)
const picked = computed(() => candidates[pickedIndex.value])

// 20px 档候选按原生尺寸渲染（项目约定：不靠拉伸 16 再放大）
function iconStyle(c: Candidate) {
  return c.px === 16 ? undefined : { width: `${c.px}px`, height: `${c.px}px` }
}

const snippet = computed(() => {
  const c = picked.value
  if (!c) return ''
  return [
    `// GlobalSidebar.vue`,
    `import { ${c.name}, Settings16Regular } from '@vicons/fluent'`,
    '',
    `<!-- 移动访问入口 -->`,
    `<component :is="${c.name}" class="${c.px === 16 ? 'w-4 h-4' : 'w-5 h-5'}" />`,
  ].join('\n')
})
</script>

<style scoped>
.pick-page {
  min-height: 100vh;
  padding: 28px 32px 48px;
  background: var(--gd-color-bg, #fdfdfd);
  color: var(--gd-color-text, #171717);
  font-size: 13px;
  line-height: 1.6;
}

.pick-page > * {
  max-width: 1120px;
}

.head h2 {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
}

.sub {
  margin: 0 0 24px;
  max-width: 820px;
  color: var(--gd-color-text-gray, #666);
}

.adopted {
  margin: 0 0 10px;
  max-width: 820px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #b7e0c8;
  background: #eefaf2;
  color: #1d6b3f;
}

.adopted code {
  background: rgba(29, 107, 63, 0.1);
  color: inherit;
}

:global(html.dark) .adopted {
  border-color: #2f5c43;
  background: #16281d;
  color: #86d6a6;
}

.sub--tight {
  margin: -4px 0 12px;
}

.note-block {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px dashed var(--gd-color-border, #e8e8e8);
}

.notes {
  margin: 0;
  padding-left: 18px;
  color: var(--gd-color-text-gray, #666);
}

.notes li + li {
  margin-top: 6px;
}

.notes b {
  color: var(--gd-color-text, #171717);
}

code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--gd-color-sidebar-bg-active, #2631480f);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.block {
  margin-bottom: 32px;
}

.block-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
}

/* ── 侧边栏还原 ── */
.preview-grid {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.preview {
  width: 320px;
  border-radius: 10px;
  border: 1px solid var(--gd-color-border, #e8e8e8);
  overflow: hidden;
}

.preview-label {
  padding: 4px 10px;
  font-size: 11px;
  color: #888;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.preview.light .preview-body {
  background: #f6f6f6;
  color: #171717;
}

.preview.dark .preview-body {
  background: #2b2b2b;
  color: #dcdcdc;
}

.preview.dark .preview-label {
  color: #aaa;
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.preview-body {
  padding: 10px 12px 12px;
}

.group-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  margin-bottom: 6px;
}

.folder {
  width: 16px;
  height: 16px;
  flex: none;
}

.group-name,
.user-name {
  font-size: 13px;
  font-weight: 500;
}

.user-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 8px;
}

.avatar {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 30%, #8fd3f4, #5b8ec9 70%);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}

.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.hit {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 10px;
  border-radius: 8px;
  color: #666;
}

.preview.dark .hit {
  color: #b0b0b0;
}

.hit--active {
  background: #2631480f;
  color: #171717;
}

.preview.dark .hit--active {
  background: #414141;
  color: #dcdcdc;
}

.ico {
  width: 16px;
  height: 16px;
  display: block;
}

.dot {
  position: absolute;
  top: 4px;
  right: 5px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #10b981;
}

/* ── 候选卡片 ── */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(266px, 1fr));
  gap: 12px;
}

.card {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--gd-color-border, #e8e8e8);
  background: var(--gd-color-surface, #fff);
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.card:hover {
  border-color: #9db8d8;
}

.card.picked {
  border-color: #4a89dc;
  box-shadow: 0 0 0 2px rgba(74, 137, 220, 0.18);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.card-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  font-weight: 600;
}

.badge {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
}

.badge--rec {
  background: #e8f1ff;
  color: #1f5fbf;
}

.badge--size {
  margin-left: auto;
  background: var(--gd-color-sidebar-bg-active, #2631480f);
  color: var(--gd-color-text-gray, #666);
}

.card-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--gd-color-text-gray, #666);
  min-height: 54px;
}

.card-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.zoom {
  flex: none;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gd-color-sidebar-bg, #f6f6f6);
  color: #171717;
}

.zoom-ico {
  width: 40px;
  height: 40px;
}

.pairs {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pair {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 4px;
  border-radius: 6px;
}

.pair.light {
  background: #f6f6f6;
  color: #171717;
}

.pair.dark {
  background: #2b2b2b;
  color: #dcdcdc;
}

.pair-tag {
  width: 10px;
  font-size: 10px;
  color: #999;
}

.pair .ico {
  color: inherit;
}

.ico--ref {
  color: #666;
}
.pair.dark .ico--ref {
  color: #b0b0b0;
}

/* ── 已选 ── */
.picked-block {
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--gd-color-border, #e8e8e8);
  background: var(--gd-color-surface, #fff);
}

.snippet {
  margin: 12px 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--gd-color-sidebar-bg, #f6f6f6);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--gd-color-text-gray, #666);
}
</style>
