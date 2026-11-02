<template>
  <div class="schedule-sentence">
    <!-- 一句话调度：频率 + 条件 + 于 + 时间 + 时区 -->
    <div class="sentence-shell" :class="{ 'has-error': !!error }">
      <GdSelect v-model="frequency" class="sched-pill freq-pill" :teleported="true">
        <GdOption v-for="option in frequencyOptions" :key="option.value" :label="option.label"
          :value="option.value" />
      </GdSelect>

      <!-- 每小时 / 每 N 小时：分钟 -->
      <template v-if="draft.frequency === 'every_hours'">
        <GdSelect :model-value="draft.intervalHours" class="sched-pill num-pill" :teleported="true"
          @update:model-value="emitDraft({ intervalHours: Number($event) })">
          <GdOption v-for="n in 23" :key="n" :label="String(n)" :value="n" />
        </GdSelect>
        <span class="sentence-text">{{ t('scheduler.schedule.hourUnit') }}</span>
      </template>

      <template v-if="draft.frequency === 'hourly' || draft.frequency === 'every_hours'">
        <span class="sentence-text">{{ t('scheduler.schedule.minutePrefix') }}</span>
        <GdSelect :model-value="draft.minute" class="sched-pill num-pill" :teleported="true"
          @update:model-value="emitDraft({ minute: Number($event) })">
          <GdOption v-for="m in minuteOptions" :key="m" :label="pad2(m)" :value="m" />
        </GdSelect>
        <span class="sentence-text">{{ t('scheduler.schedule.minuteUnit') }}</span>
      </template>

      <!-- 每周 / 每月：条件选择 -->
      <template v-if="draft.frequency === 'weekly'">
        <button ref="weekdayButtonRef" type="button" class="sched-pill trigger-pill"
          @click.stop="weekdayPopoverVisible = !weekdayPopoverVisible">
          <span class="truncate max-w-40">{{ weeklySummary }}</span>
          <ChevronDown16Regular class="w-3 h-3"  />
        </button>
        <GdPopover :show="weekdayPopoverVisible" @update:show="weekdayPopoverVisible = $event" :width="288"
          :anchor-el="weekdayButtonRef">
          <div class="day-grid">
            <button v-for="day in 7" :key="day - 1" type="button" class="day-chip"
              :class="{ active: draft.weekdays.includes(day - 1) }" @click="toggleWeekday(day - 1)">
              {{ weekdayLabels[day - 1] }}
            </button>
          </div>
          <div class="day-actions">
            <button type="button" class="day-action" @click="setWeekdays([1, 2, 3, 4, 5])">
              {{ t('scheduler.schedule.workdays') }}
            </button>
            <button type="button" class="day-action" @click="setWeekdays([0, 1, 2, 3, 4, 5, 6])">
              {{ t('scheduler.schedule.everyDay') }}
            </button>
          </div>
        </GdPopover>
      </template>

      <template v-if="draft.frequency === 'monthly'">
        <button ref="monthDayButtonRef" type="button" class="sched-pill trigger-pill"
          @click.stop="monthDayPopoverVisible = !monthDayPopoverVisible">
          <span class="truncate max-w-40">{{ monthlySummary }}</span>
          <ChevronDown16Regular class="w-3 h-3"  />
        </button>
        <GdPopover :show="monthDayPopoverVisible" @update:show="monthDayPopoverVisible = $event" :width="320"
          :anchor-el="monthDayButtonRef">
          <div class="month-day-grid">
            <button v-for="day in 31" :key="day" type="button" class="day-chip day-chip-sm"
              :class="{ active: draft.monthDays.includes(day) }" @click="toggleMonthDay(day)">
              {{ day }}
            </button>
          </div>
        </GdPopover>
      </template>

      <template v-if="draft.frequency === 'once'">
        <span class="sentence-text">{{ t('scheduler.schedule.at') }}</span>
        <GdDatePicker :model-value="draft.onceAt" size="small" class="sched-date"
          :placeholder="t('scheduler.schedule.oncePlaceholder')"
          @update:model-value="emitDraft({ onceAt: $event })" />
      </template>

      <template v-else-if="needsTime">
        <span class="sentence-text">{{ t('scheduler.schedule.at') }}</span>
        <GdTimePicker :model-value="timeValue" size="small" class="sched-time"
          @update:model-value="handleTimeChange" />
      </template>

      <template v-if="draft.frequency === 'custom'">
        <GdInput :model-value="draft.cronExpression" class="sched-cron" placeholder="0 9 * * *" spellcheck="false"
          @update:model-value="emitDraft({ cronExpression: $event })" />
      </template>

      <span v-if="draft.frequency !== 'once'" class="sentence-tz">{{ SCHEDULE_TIMEZONE_LABEL }}</span>

      <span class="sentence-preview">
        {{ nextRunLabel }}
      </span>
    </div>

    <p v-if="error" class="sentence-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown16Regular } from '@vicons/fluent'
import GdPopover from '@/components/ui/GdPopover.vue'
import GdDatePicker from '@/components/ui/GdDatePicker.vue'
import GdTimePicker from '@/components/ui/GdTimePicker.vue'
import GdInput from '@/components/ui/GdInput.vue'
import GdSelect from '@/components/ui/GdSelect.vue';
import GdOption from '@/components/ui/GdSelectOption';
import {
  SCHEDULE_TIMEZONE_LABEL,
  computeNextRun,
  formatNextRun,
  parseLocalDateTime,
  toLocalDateTimeString,
  type ScheduleDraft,
  type ScheduleFrequency,
} from './schedule'

const props = defineProps<{
  modelValue: ScheduleDraft
  error?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ScheduleDraft]
}>()

const { t, locale } = useI18n()

/** 只读引用 props，所有编辑通过 emitDraft 回写，避免直接改 props */
const draft = computed(() => props.modelValue)

const weekdayButtonRef = ref<HTMLElement | null>(null)
const monthDayButtonRef = ref<HTMLElement | null>(null)
const weekdayPopoverVisible = ref(false)
const monthDayPopoverVisible = ref(false)

const frequencyOptions = computed(() => [
  { value: 'hourly' as const, label: t('scheduler.schedule.freq.hourly') },
  { value: 'every_hours' as const, label: t('scheduler.schedule.freq.everyHours') },
  { value: 'daily' as const, label: t('scheduler.schedule.freq.daily') },
  { value: 'weekdays' as const, label: t('scheduler.schedule.freq.weekdays') },
  { value: 'weekly' as const, label: t('scheduler.schedule.freq.weekly') },
  { value: 'monthly' as const, label: t('scheduler.schedule.freq.monthly') },
  { value: 'once' as const, label: t('scheduler.schedule.freq.once') },
  { value: 'custom' as const, label: t('scheduler.schedule.freq.custom') },
])

const weekdayLabels = computed(() => [
  t('common.weekday.sunday'),
  t('common.weekday.monday'),
  t('common.weekday.tuesday'),
  t('common.weekday.wednesday'),
  t('common.weekday.thursday'),
  t('common.weekday.friday'),
  t('common.weekday.saturday'),
])

const minuteOptions = Array.from({ length: 60 }, (_, i) => i)

const needsTime = computed(() =>
  ['daily', 'weekdays', 'weekly', 'monthly'].includes(props.modelValue.frequency),
)

const timeValue = computed(
  () => `${pad2(props.modelValue.hour)}:${pad2(props.modelValue.minute)}`,
)

const weeklySummary = computed(() => {
  const days = [...props.modelValue.weekdays].sort((a, b) => a - b)
  if (days.length === 0) return t('scheduler.schedule.pickWeekday')
  if (days.length === 7) return t('scheduler.schedule.everyDay')
  if (days.join(',') === '1,2,3,4,5') return t('scheduler.schedule.workdays')
  return days.map((day) => weekdayLabels.value[day]).join(t('scheduler.format.listSeparator'))
})

const monthlySummary = computed(() => {
  const days = [...props.modelValue.monthDays].sort((a, b) => a - b)
  if (days.length === 0) return t('scheduler.schedule.pickMonthDay')
  return days
    .map((day) => t('scheduler.format.dayOfMonth', { day }))
    .join(t('scheduler.format.listSeparator'))
})

const nextRunLabel = computed(() => {
  if (props.modelValue.frequency === 'custom') return t('scheduler.schedule.nextRunUnknown')
  if (props.modelValue.frequency === 'once' && !parseLocalDateTime(props.modelValue.onceAt)) {
    return t('scheduler.schedule.nextRunUnknown')
  }
  const next = computeNextRun(props.modelValue)
  if (!next) return t('scheduler.schedule.nextRunUnknown')
  return t('scheduler.schedule.nextRun', {
    time: formatNextRun(next, t, locale.value),
  })
})

/** 频率变化时同步默认的一次性时间，避免切到「仅一次」后一片空白 */
const frequency = computed<ScheduleFrequency>({
  get: () => props.modelValue.frequency,
  set: (value) => {
    const next: ScheduleDraft = { ...props.modelValue, frequency: value }
    if (value === 'once' && !next.onceAt) {
      const date = new Date(Date.now() + 60 * 60 * 1000)
      date.setSeconds(0, 0)
      next.onceAt = toLocalDateTimeString(date)
    }
    if (value === 'weekly' && next.weekdays.length === 0) next.weekdays = [1]
    if (value === 'monthly' && next.monthDays.length === 0) next.monthDays = [1]
    if (value === 'custom' && !next.cronExpression) next.cronExpression = '0 9 * * *'
    emit('update:modelValue', next)
  },
})

function emitDraft(patch: Partial<ScheduleDraft> = {}) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function handleTimeChange(value: string | null) {
  if (!value) return
  const [hour, minute] = value.split(':').map(Number)
  emitDraft({ hour: Number.isFinite(hour) ? hour : 9, minute: Number.isFinite(minute) ? minute : 0 })
}

function toggleWeekday(day: number) {
  const current = new Set(props.modelValue.weekdays)
  if (current.has(day)) current.delete(day)
  else current.add(day)
  emitDraft({ weekdays: Array.from(current).sort((a, b) => a - b) })
}

function setWeekdays(days: number[]) {
  emitDraft({ weekdays: days })
  weekdayPopoverVisible.value = false
}

function toggleMonthDay(day: number) {
  const current = new Set(props.modelValue.monthDays)
  if (current.has(day)) current.delete(day)
  else current.add(day)
  emitDraft({ monthDays: Array.from(current).sort((a, b) => a - b) })
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
</script>

<style scoped>
.schedule-sentence {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sentence-shell {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 30px;
  padding: 2px 0;
  border: none;
  background: transparent;
}

.sentence-shell.has-error {
  border-radius: 8px;
  box-shadow: 0 0 0 1px var(--gd-color-danger);
}

.sentence-text {
  font-size: 13px;
  color: var(--gd-color-text-gray);
  white-space: nowrap;
}

.sentence-tz {
  font-size: 12px;
  color: var(--gd-color-text-disabled);
}

.sentence-preview {
  margin-left: auto;
  font-size: 12px;
  color: var(--gd-color-text-gray);
  white-space: nowrap;
}

.sentence-error {
  margin: 0;
  font-size: 12px;
  color: var(--gd-color-danger);
}

.sched-pill {
  flex: 0 0 auto;
}

.sentence-shell :deep(.freq-pill) {
  width: 104px;
}

.sentence-shell :deep(.sched-time) {
  width: 96px;
  flex: 0 0 auto;
  border-radius: 999px;
}

.sentence-shell :deep(.sched-date) {
  width: 198px;
  flex: 0 0 auto;
  border-radius: 999px;
}

.sentence-shell :deep(.sched-cron) {
  width: 200px;
  flex: 0 0 auto;
}

.freq-pill {
  width: 104px;
}

.num-pill {
  width: 70px;
}

.trigger-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  max-width: 220px;
  padding: 0 10px;
  border: none;
  border-radius: 999px;
  background: var(--gd-color-field-bg);
  color: var(--gd-color-text);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.trigger-pill:hover {
  background: var(--gd-color-field-bg-hover);
}

/* GdTimePicker/GdDatePicker/GdInput 的 small 档自带 26px 高，这里只收敛字重与等宽 */
.sentence-shell :deep(.sched-cron input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.day-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.month-day-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.day-chip {
  height: 30px;
  border: none;
  border-radius: 8px;
  background: var(--gd-color-field-bg);
  color: var(--gd-color-text);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.day-chip-sm {
  height: 28px;
}

.day-chip:hover {
  background: var(--gd-color-field-bg-hover);
}

.day-chip.active {
  background: var(--gd-color-primary);
  color: #fff;
}

.day-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.day-action {
  border: none;
  background: transparent;
  color: var(--gd-color-primary);
  font-size: 12px;
  cursor: pointer;
}
</style>
