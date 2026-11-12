/**
 * 桌宠安装确认（统一 UI，替代原生 dialog.showMessageBox）。
 *
 * 三个入口都走这里：市场卡片、设置页 slug 输入、以及将来的推荐位。
 * 明确告知会执行第三方 `npx petdex install` 脚本——这是安全确认，不是普通提示。
 */
import { t } from '@/locales'
import { usePopup } from '@/composables/usePopup'

/** 返回 true 才继续执行安装；取消/关闭都返回 false */
export async function confirmPetInstall(slug: string): Promise<boolean> {
  const { confirm } = usePopup()
  return confirm(
    t('settings.pet.installConfirmTitle'),
    t('settings.pet.installConfirmContent', { slug }),
    {
      type: 'warning',
      size: 'sm',
      confirmText: t('settings.pet.marketInstall'),
      cancelText: t('common.cancel'),
    },
  )
}
