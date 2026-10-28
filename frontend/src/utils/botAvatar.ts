import { fixFrontendAssetUrl } from './url'

/** 各平台默认头像（统一取自 public/images/bots） */
const BOT_PLATFORM_AVATARS: Record<string, string> = {
  qq: '/images/bots/qq.png',
  wechat: '/images/bots/wechat.png',
  'wechat-personal': '/images/bots/wechat.png',
  discord: '/images/bots/discord.svg',
  dingtalk: '/images/bots/dingtalk.svg',
  lark: '/images/bots/lark.png',
  wecom: '/images/bots/wecom-bot.png',
}

/** 机器人平台头像地址；未知平台回退 QQ 图标 */
export function getBotPlatformAvatar(platform?: string | null): string {
  const path =
    BOT_PLATFORM_AVATARS[(platform ?? '').toLowerCase()] ||
    '/images/bots/qq.png'
  return fixFrontendAssetUrl(path)
}

/** 头像加载失败：隐藏破图，父容器显示 BOT 占位 */
export function handleBotAvatarError(event: Event): void {
  const target = event.target as HTMLImageElement | null
  if (!target) return
  target.style.display = 'none'
  const parent = target.parentElement
  if (parent) {
    parent.textContent = 'BOT'
    parent.classList.add('text-gray-400', 'text-xs')
  }
}
