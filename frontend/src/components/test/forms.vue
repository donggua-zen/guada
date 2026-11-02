<template>
    <div class="p-6 max-w-[900px]">
        <h1 class="mb-4 text-lg font-semibold">GdInput / GdSwitch / GdSelect 全矩阵测试</h1>

        <!-- ==================== GdInput ==================== -->
        <h2 class="mt-6 mb-2 font-semibold">GdInput · variant × size</h2>
        <div v-for="size in sizes" :key="`i-${size}`" class="mb-4">
            <h3 class="mb-1 text-[13px] text-[var(--gd-color-text-gray)]">{{ size }}</h3>
            <div class="grid grid-cols-2 gap-3">
                <GdInput v-model="inputVal" :size="size" placeholder="filled（默认）灰底无边框" clearable />
                <GdInput v-model="inputVal" :size="size" variant="outline" placeholder="outline 白底描边" clearable />
                <GdInput v-model="inputVal" :size="size" placeholder="禁用" disabled />
                <GdInput v-model="inputVal" :size="size" variant="outline" placeholder="禁用" disabled />
                <GdInput v-model="inputVal" :size="size" placeholder="错误态" error />
                <GdInput v-model="inputVal" :size="size" placeholder="readonly" readonly />
            </div>
        </div>

        <h2 class="mt-6 mb-2 font-semibold">GdInput · 密码 / 字数 / 插槽</h2>
        <div class="grid grid-cols-2 gap-3">
            <GdInput v-model="pwdVal" type="password" show-password placeholder="密码" clearable />
            <GdInput v-model="pwdVal" type="password" show-password variant="outline" placeholder="密码 outline" />
            <GdInput v-model="limitVal" :maxlength="20" show-word-limit placeholder="字数统计" />
            <GdInput v-model="limitVal" type="textarea" :maxlength="100" show-word-limit placeholder="textarea 字数统计" />
            <GdInput v-model="searchVal" placeholder="带 prefix 图标" clearable>
                <template #prefix>
                    <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                </template>
            </GdInput>
            <GdInput v-model="inputVal" placeholder="带 suffix 插槽">
                <template #suffix>
                    <span class="text-[12px] text-[var(--gd-color-text-gray)]">单位</span>
                </template>
            </GdInput>
        </div>

        <h2 class="mt-6 mb-2 font-semibold">GdInput · textarea / autosize</h2>
        <div class="grid gap-3">
            <GdInput v-model="taVal" type="textarea" :rows="3" placeholder="textarea rows=3" />
            <GdInput v-model="taVal" type="textarea" autosize placeholder="autosize（初始 1 行）" />
            <GdInput v-model="taVal" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" placeholder="autosize minRows=3 maxRows=6" />
            <GdInput v-model="taVal" type="textarea" :rows="2" resize="none" placeholder="resize=none" />
        </div>

        <h2 class="mt-6 mb-2 font-semibold">GdInput · @keyup.enter 透传</h2>
        <div class="grid grid-cols-2 gap-3">
            <GdInput v-model="inputVal" placeholder="回车后看下方提示" @keyup.enter="enterHint = `enter @ ${new Date().toLocaleTimeString()}`" />
            <div class="flex items-center text-[13px] text-[var(--gd-color-text-gray)]">{{ enterHint || '（等待回车）' }}</div>
        </div>

        <!-- ==================== GdSwitch ==================== -->
        <h2 class="mt-8 mb-2 font-semibold">GdSwitch · 状态矩阵</h2>
        <div class="flex flex-wrap items-center gap-6">
            <GdSwitch v-model="sw1" />
            <GdSwitch v-model="sw2" />
            <GdSwitch v-model="sw1" disabled />
            <GdSwitch v-model="sw2" disabled />
            <GdSwitch v-model="sw1" loading />
            <GdSwitch v-model="sw3" active-value="on" inactive-value="off" @change="hint = `active-value: ${sw3}`" />
            <span class="text-[13px] text-[var(--gd-color-text-gray)]">{{ hint || '（active-value 演示）' }}</span>
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-6">
            <GdSwitch v-model="sw4" inline-prompt active-text="启" inactive-text="停" />
            <GdSwitch v-model="sw4" inline-prompt active-text="ON" inactive-text="OFF" size="small" />
            <GdSwitch v-model="sw4" size="small" />
            <GdSwitch v-model="sw4" disabled inline-prompt active-text="禁" inactive-text="用" />
        </div>

        <!-- ==================== GdSelect ==================== -->
        <h2 class="mt-8 mb-2 font-semibold">GdSelect · 基础 × size × variant</h2>
        <div v-for="size in sizes" :key="`s-${size}`" class="mb-4">
            <h3 class="mb-1 text-[13px] text-[var(--gd-color-text-gray)]">{{ size }}</h3>
            <div class="grid grid-cols-2 gap-3">
                <GdSelect v-model="selVal" :options="fruitOptions" :size="size" placeholder="请选择" clearable />
                <GdSelect v-model="selVal" :options="fruitOptions" :size="size" variant="outline" placeholder="outline" clearable />
                <GdSelect v-model="selVal" :options="fruitOptions" :size="size" placeholder="禁用" disabled />
                <GdSelect :model-value="null" :options="[]" :size="size" placeholder="空列表 no-data" />
            </div>
        </div>

        <h2 class="mt-6 mb-2 font-semibold">GdSelect · filterable / allow-create / multiple</h2>
        <div class="grid grid-cols-2 gap-3">
            <GdSelect v-model="selVal" :options="fruitOptions" filterable clearable placeholder="filterable" />
            <GdSelect v-model="createVal" :options="tagOptions" filterable allow-create default-first-option clearable placeholder="可输可选（allow-create）" />
            <GdSelect v-model="multiVal" :options="fruitOptions" multiple placeholder="multiple" />
            <GdSelect v-model="multiVal" :options="fruitOptions" multiple filterable placeholder="multiple + filterable" />
            <GdSelect v-model="selVal" :options="fruitOptions" loading placeholder="loading 态" />
            <GdSelect v-model="disOptVal" :options="withDisabledOptions" placeholder="含 disabled 项" />
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdInputNumber · 矩阵</h2>
        <div class="grid grid-cols-2 gap-3">
            <GdInputNumber v-model="numVal" :min="1" :max="100" placeholder="1~100 步进 1" />
            <GdInputNumber v-model="numVal" :min="0" :max="2" :step="0.1" placeholder="0~2 步进 0.1（小数）" />
            <GdInputNumber v-model="numVal" :min="0" :max="1" :step="0.05" placeholder="0.05 步进" />
            <GdInputNumber v-model="nullableVal" :min="0" :max="2" :step="0.1" placeholder="空 = 模型默认（null）" />
            <GdInputNumber v-model="numVal" :controls="false" :min="1" :max="65535" placeholder="controls=false 纯输入" />
            <GdInputNumber v-model="numVal" :min="1" :max="100" disabled placeholder="禁用" />
            <GdInputNumber v-model="numVal" :min="10" :max="3600" :step="10" placeholder="带 #suffix">
                <template #suffix><span class="text-[12px]">秒</span></template>
            </GdInputNumber>
            <GdInputNumber v-model="numVal" :min="-2" :max="2" :step="0.1" variant="outline" placeholder="负数 + outline" />
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdSlider · 矩阵</h2>
        <div class="grid gap-4">
            <div class="flex items-center gap-4">
                <span class="w-28 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">基础 0~100</span>
                <GdSlider v-model="sliderVal" :min="0" :max="100" :step="1" />
            </div>
            <div class="flex items-center gap-4">
                <span class="w-28 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">小数步进</span>
                <GdSlider v-model="weightVal" :min="0" :max="1" :step="0.05" />
            </div>
            <div class="flex items-center gap-4">
                <span class="w-28 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">show-input</span>
                <GdSlider v-model="sliderVal" :min="1" :max="20" :step="1" show-input />
            </div>
            <div class="flex items-center gap-4">
                <span class="w-28 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">tooltip 关闭</span>
                <GdSlider v-model="sliderVal" :min="0" :max="8" :step="1" :show-tooltip="false" />
            </div>
            <div class="flex items-center gap-4">
                <span class="w-28 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">format</span>
                <GdSlider v-model="sliderVal" :min="0" :max="100" :step="1" :format-tooltip="(v: number) => `${v}%`" />
            </div>
            <div class="flex items-center gap-4">
                <span class="w-28 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">small</span>
                <GdSlider v-model="sliderVal" :min="0" :max="100" :step="1" size="small" />
            </div>
            <div class="flex items-center gap-4">
                <span class="w-28 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">optional（Auto）</span>
                <GdSliderOptional v-model="optionalSliderVal" :min="0" :max="100" :step="1" optional-direction="max" optional-text="No Limit" />
            </div>
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdToast · 五态 / 堆叠 / 常驻 loading / closeAll</h2>
        <div class="flex flex-wrap gap-2">
            <GdButton type="primary" @click="toast.success('保存成功')">success</GdButton>
            <GdButton type="danger" @click="toast.error('删除失败：连接已断开（可关闭）')">error</GdButton>
            <GdButton type="warning" @click="toast.warning('磁盘空间不足')">warning</GdButton>
            <GdButton @click="toast.info('已同步到剪贴板')">info</GdButton>
            <GdButton @click="stackToasts">连续 5 条（堆叠）</GdButton>
            <GdButton @click="testLoading">loading 常驻 → 2s 后关</GdButton>
            <GdButton @click="notify.error('同步失败', '无法连接到服务器，请检查网络后重试')">notify（标题+正文）</GdButton>
            <GdButton type="secondary" @click="closeAllToasts()">closeAll</GdButton>
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdTag · 五色 × 三态 × closable</h2>
        <div v-for="effect in (['light', 'plain', 'dark'] as const)" :key="effect" class="mb-3">
            <h3 class="mb-1 text-[13px] text-[var(--gd-color-text-gray)]">{{ effect }}</h3>
            <div class="flex flex-wrap items-center gap-2">
                <GdTag v-for="t in (['info', 'success', 'warning', 'danger', 'primary'] as const)" :key="t" :type="t" :effect="effect">{{ t }}</GdTag>
                <GdTag type="error" :effect="effect">error 别名</GdTag>
                <GdTag :effect="effect" closable @close="toast.info('tag closed')">可关闭</GdTag>
                <GdTag :effect="effect">
                    <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><path d="m8.5 12.5 2.5 2.5 5-5.5" /></svg>
                    带图标
                </GdTag>
                <GdTag type="success" size="medium" :effect="effect">medium</GdTag>
            </div>
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdAlert · 四色 / 双内容形态 / show-icon</h2>
        <div class="grid gap-3">
            <GdAlert type="warning" title="纯 title（自闭合形态）" />
            <GdAlert type="error" title="title + description prop" description="这是 description prop 的正文内容。" />
            <GdAlert type="info" title="默认插槽形态">
                <p class="m-0 text-sm">默认插槽第一段。</p>
                <p class="m-0 text-xs text-[var(--gd-color-text-disabled)]">嵌套 div 富文本（TurnItem 形态）。</p>
            </GdAlert>
            <GdAlert type="warning" show-icon title="show-icon 带语义图标" description="图标走 semanticIcons 共享件。" />
            <GdAlert type="success" show-icon title="success 色" />
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdProgress · indeterminate / color 函数 / status</h2>
        <div class="grid gap-3">
            <div class="flex items-center gap-3">
                <span class="w-32 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">基础 60%</span>
                <GdProgress :percentage="60" />
            </div>
            <div class="flex items-center gap-3">
                <span class="w-32 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">粗 8 / 无文字</span>
                <GdProgress :percentage="80" :stroke-width="8" :show-text="false" />
            </div>
            <div class="flex items-center gap-3">
                <span class="w-32 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">细 3 / warning</span>
                <GdProgress :percentage="45" :stroke-width="3" status="warning" />
            </div>
            <div class="flex items-center gap-3">
                <span class="w-32 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">indeterminate 流光</span>
                <GdProgress :percentage="0" :stroke-width="8" :show-text="false" indeterminate />
            </div>
            <div class="flex items-center gap-3">
                <span class="w-32 shrink-0 text-[13px] text-[var(--gd-color-text-gray)]">color 函数渐变</span>
                <GdProgress :percentage="72" :color="progressColorFn" />
            </div>
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdDivider / GdEmpty</h2>
        <div class="grid gap-4">
            <GdDivider />
            <GdDivider content-position="left">左对齐标题</GdDivider>
            <GdDivider content-position="right">右对齐</GdDivider>
            <div class="flex items-center gap-3">
                <span class="text-[13px]">左侧</span>
                <GdDivider direction="vertical" />
                <span class="text-[13px]">右侧（竖线）</span>
            </div>
            <GdEmpty description="暂无数据（GdEmpty 极简线稿）" :image-size="60" />
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdCheckbox / GdSegmented / GdRadio / GdFormField</h2>
        <div class="grid gap-4">
            <div class="flex flex-wrap items-center gap-6">
                <GdCheckbox v-model="cb1">基础勾选</GdCheckbox>
                <GdCheckbox v-model="cb1" disabled>禁用</GdCheckbox>
                <GdCheckbox :model-value="cb1" @change="(v: boolean) => (cb1 = v)">受控写法</GdCheckbox>
                <GdCheckbox v-model="cb1">
                    <span class="flex flex-col">
                        <span class="font-medium">富文本标题</span>
                        <span class="text-xs text-[var(--gd-color-text-gray)]">描述行（GlobalSidebar 形态）</span>
                    </span>
                </GdCheckbox>
            </div>
            <div class="flex flex-wrap gap-6">
                <GdSegmented v-model="segVal" :options="segOptions" @change="(v) => (segHint = String(v))" />
                <span class="self-center text-[12px] text-[var(--gd-color-text-gray)]">change: {{ segHint || '—' }}</span>
                <GdSegmented :model-value="segVal" :options="segOptions" disabled />
            </div>
            <GdRadioGroup v-model="radioVal" class="max-w-sm">
                <GdRadio value="overwrite">
                    <span class="flex flex-col">
                        <span class="font-medium">覆盖原文件</span>
                        <span class="text-xs text-[var(--gd-color-text-gray)]">删除已存在的同名文件（KBFileUploader 形态）</span>
                    </span>
                </GdRadio>
                <GdRadio value="keep-both">
                    <span class="flex flex-col">
                        <span class="font-medium">保留两者</span>
                        <span class="text-xs text-[var(--gd-color-text-gray)]">自动重命名后保存</span>
                    </span>
                </GdRadio>
            </GdRadioGroup>
            <div class="grid max-w-xl gap-3">
                <GdFormField label="纵排布局" required>
                    <GdInput v-model="ffVal" placeholder="label 在上（无 labelWidth）" />
                </GdFormField>
                <GdFormField label="left 布局" label-width="120px">
                    <GdInput v-model="ffVal" placeholder="label 左置固定宽右对齐" />
                </GdFormField>
                <GdFormField label="错误态" required :error="ffErr || undefined">
                    <GdInput v-model="ffVal" :error="!!ffErr" placeholder="点右侧按钮注入错误" />
                </GdFormField>
                <GdButton size="small" @click="ffErr = ffErr ? '' : '该字段不能为空'">{{ ffErr ? '清除错误' : '注入错误' }}</GdButton>
            </div>
        </div>

        <h2 class="mt-8 mb-2 font-semibold">GdTabs / GdPagination / GdCollapse</h2>
        <div class="grid gap-5">
            <div>
                <GdTabs v-model="tabsVal" :tabs="tabItems" @change="(n) => (tabsHint = n)" />
                <div class="mt-3 text-[13px] text-[var(--gd-color-text-gray)]">当前：{{ tabsVal }}（change: {{ tabsHint || '—' }}）</div>
            </div>
            <div class="flex flex-wrap items-center gap-4">
                <GdPagination v-model="pageVal" :total="186" :page-size="12" @change="(p) => (pageHint = p)" />
                <span class="text-[12px] text-[var(--gd-color-text-gray)]">change: {{ pageHint || '—' }}</span>
                <GdPagination :total="40" :page-size="20" :model-value="2" @change="(p) => toast.info('跳到第 ' + p + ' 页')" />
                <GdPagination v-model="pageVal" :total="5" :page-size="20" hide-on-single-page />
                <span class="text-[12px] text-[var(--gd-color-text-gray)]">↑ 单页应隐藏</span>
            </div>
            <div class="max-w-xl">
                <GdCollapse v-model="collapseOpen" name="advanced">
                    <template #title>
                        <span>高级设置</span>
                        <GdTag size="small" type="info">可选</GdTag>
                    </template>
                    <div class="text-[13px] text-(--gd-color-text-gray)">折叠区内容（grid-rows 过渡动画）。</div>
                </GdCollapse>
            </div>
        </div>

        <h2 class="mt-6 mb-2 font-semibold">值面板</h2>
        <div class="rounded-md bg-[var(--gd-color-surface-subtle)] p-3 text-[12px] leading-5">
            inputVal: {{ JSON.stringify(inputVal) }} · pwdVal.length: {{ pwdVal.length }} · limitVal: {{ JSON.stringify(limitVal) }}<br>
            selVal: {{ JSON.stringify(selVal) }} · createVal: {{ JSON.stringify(createVal) }} · multiVal: {{ JSON.stringify(multiVal) }}<br>
            sw1: {{ sw1 }} · sw3: {{ sw3 }} · sw4: {{ sw4 }}<br>
            numVal: {{ JSON.stringify(numVal) }} · nullableVal: {{ JSON.stringify(nullableVal) }} · sliderVal: {{ sliderVal }} · weightVal: {{ weightVal }} · optional: {{ JSON.stringify(optionalSliderVal) }}
        </div>
    </div>
</template>
<script setup lang="ts">
import { ref } from "vue";
import GdInput from "../ui/GdInput.vue";
import GdSwitch from "../ui/GdSwitch.vue";
import GdSelect from "../ui/GdSelect.vue";
import GdInputNumber from "../ui/GdInputNumber.vue";
import GdSlider from "../ui/GdSlider.vue";
import GdSliderOptional from "../ui/GdSliderOptional.vue";
import GdButton from "../ui/GdButton.vue";
import GdTag from "../ui/GdTag.vue";
import GdAlert from "../ui/GdAlert.vue";
import GdProgress from "../ui/GdProgress.vue";
import GdDivider from "../ui/GdDivider.vue";
import GdEmpty from "../ui/GdEmpty.vue";
import GdFormField from "../ui/GdFormField.vue";
import GdCheckbox from "../ui/GdCheckbox.vue";
import GdSegmented from "../ui/GdSegmented.vue";
import GdRadio from "../ui/GdRadio.vue";
import GdRadioGroup from "../ui/GdRadioGroup.vue";
import { toast, notify, pushToast, closeAllToasts } from "../ui/toastService";
import type { GdSelectOption } from "../ui/GdSelect.vue";

const sizes = ["tiny", "small", "medium"] as const;

const inputVal = ref("");
const pwdVal = ref("secret123");
const limitVal = ref("");
const searchVal = ref("");
const taVal = ref("");
const enterHint = ref("");

const sw1 = ref(true);
const sw2 = ref(false);
const sw3 = ref("on");
const sw4 = ref(true);
const hint = ref("");

const selVal = ref<string | number>("");
const createVal = ref<string | number>("");
const multiVal = ref<Array<string | number>>(["apple"]);
const disOptVal = ref<string | number>("");

const numVal = ref<number | null>(10);
const nullableVal = ref<number | null>(null);
const sliderVal = ref(30);
const weightVal = ref(0.5);
const optionalSliderVal = ref<number | null>(null);

const stackToasts = () => {
    for (let i = 1; i <= 5; i++) pushToast({ type: 'info', content: `堆叠消息 ${i}` });
};
const testLoading = () => {
    const handle = toast.loading('正在处理…');
    setTimeout(() => handle.close(), 2000);
};
const progressColorFn = (p: number): string =>
    p < 40 ? 'var(--gd-color-success)' : p < 80 ? 'var(--gd-color-warning)' : 'var(--gd-color-danger)';

const cb1 = ref(true);
const segVal = ref('text');
const segHint = ref('');
const radioVal = ref('overwrite');
const ffVal = ref('');
const ffErr = ref('');
const tabsVal = ref('files');
const tabsHint = ref('');
const pageVal = ref(1);
const pageHint = ref(0);
const collapseOpen = ref<string[]>([]);
const tabItems = [
  { name: 'files', label: '文件列表' },
  { name: 'search', label: '搜索' },
];
const segOptions = [
    { label: '文本', value: 'text' },
    { label: '向量', value: 'embedding' },
    { label: '禁用项', value: 'disabled', disabled: true },
];

const fruitOptions: GdSelectOption[] = [
    { label: "苹果", value: "apple" },
    { label: "香蕉", value: "banana" },
    { label: "樱桃", value: "cherry" },
    { label: "葡萄", value: "grape" },
    { label: "芒果", value: "mango" },
    { label: "橙子 Orange（较长文案测试截断）", value: "orange" },
];
const tagOptions: GdSelectOption[] = [
    { label: "前端", value: "frontend" },
    { label: "后端", value: "backend" },
    { label: "测试", value: "qa" },
];
const withDisabledOptions: GdSelectOption[] = [
    { label: "可选 A", value: "a" },
    { label: "不可选 B", value: "b", disabled: true },
    { label: "可选 C", value: "c" },
];
</script>
