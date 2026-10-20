import { markRaw, type Component } from 'vue'
import {
  FolderOpen16Regular,
  Code16Regular,
  Briefcase16Regular,
  Document16Regular,
  Database20Regular,
  ChartMultiple20Regular,
  DataTrending16Regular,
  Globe16Regular,
  Wrench16Regular,
  DeveloperBoard20Regular,
  Desktop16Regular,
  Comment16Regular,
  Wand16Regular,
  PuzzlePiece16Regular,
  Print16Regular,
  PlayCircle16Regular,
  Rocket16Regular,
  PaintBrush16Regular,
  MusicNote216Regular,
  Games16Regular,
  Cloud16Regular,
  Bot20Regular,
  BookOpen16Regular,
  Star16Regular,
} from '@vicons/fluent'

/**
 * 分组 / 项目自定义图标注册表。
 *
 * 数据库只存语义 key（`code` / `rocket` 等），前端静态映射到 Fluent 组件：
 * - 不随库迁移变化：新增图标只改这里；
 * - 不做 `import * as FluentIcons`，避免整包图标进 bundle；
 * - 未知 key 一律回退默认文件夹，历史/手改数据不会渲染成空白。
 */
export type GroupIconKey =
  | 'code'
  | 'board'
  | 'tool'
  | 'desktop'
  | 'comment'
  | 'document'
  | 'print'
  | 'database'
  | 'chart'
  | 'trending'
  | 'globe'
  | 'ai'
  | 'puzzle'
  | 'cloud'
  | 'rocket'
  | 'design'
  | 'wand'
  | 'music'
  | 'play'
  | 'games'
  | 'briefcase'
  | 'book'
  | 'star'

export interface GroupIconOption {
  /** null = 默认文件夹（等价于清除自定义图标） */
  key: GroupIconKey | null
  component: Component
}

export const DEFAULT_GROUP_ICON = markRaw(FolderOpen16Regular)

const GROUP_ICON_MAP: Record<GroupIconKey, Component> = {
  code: markRaw(Code16Regular),
  board: markRaw(DeveloperBoard20Regular),
  tool: markRaw(Wrench16Regular),
  desktop: markRaw(Desktop16Regular),
  comment: markRaw(Comment16Regular),
  document: markRaw(Document16Regular),
  print: markRaw(Print16Regular),
  database: markRaw(Database20Regular),
  chart: markRaw(ChartMultiple20Regular),
  trending: markRaw(DataTrending16Regular),
  globe: markRaw(Globe16Regular),
  ai: markRaw(Bot20Regular),
  puzzle: markRaw(PuzzlePiece16Regular),
  cloud: markRaw(Cloud16Regular),
  rocket: markRaw(Rocket16Regular),
  design: markRaw(PaintBrush16Regular),
  wand: markRaw(Wand16Regular),
  music: markRaw(MusicNote216Regular),
  play: markRaw(PlayCircle16Regular),
  games: markRaw(Games16Regular),
  briefcase: markRaw(Briefcase16Regular),
  book: markRaw(BookOpen16Regular),
  star: markRaw(Star16Regular),
}

/** 选择器顺序：默认项在最前，其余按使用频率排列 */
export const GROUP_ICON_OPTIONS: GroupIconOption[] = [
  { key: null, component: DEFAULT_GROUP_ICON },
  ...(
    [
      'code',
      'board',
      'tool',
      'desktop',
      'comment',
      'document',
      'print',
      'database',
      'chart',
      'trending',
      'globe',
      'ai',
      'puzzle',
      'cloud',
      'rocket',
      'design',
      'wand',
      'music',
      'play',
      'games',
      'briefcase',
      'book',
      'star',
    ] as GroupIconKey[]
  ).map((key) => ({ key, component: GROUP_ICON_MAP[key] })),
]

export function resolveGroupIcon(icon?: string | null): Component {
  if (!icon) return DEFAULT_GROUP_ICON
  return GROUP_ICON_MAP[icon as GroupIconKey] ?? DEFAULT_GROUP_ICON
}

export function isGroupIconKey(value: string): value is GroupIconKey {
  return value in GROUP_ICON_MAP
}
