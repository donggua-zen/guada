<template>
    <div class="community-panel">
        <!-- 社区 -->
        <div class="w-full bg-(--color-surface-elevated) rounded-lg p-6 border border-(--color-border)">
            <h3 class="text-sm font-medium text-(--color-text-primary) mb-4">{{ t('settings.system.community.joinCommunity') }}</h3>
            <p class="text-sm text-(--color-text-secondary) mb-6">{{ t('settings.system.community.communityDesc') }}</p>
            <!-- 反馈链接 -->
            <div class="flex items-center justify-between cursor-pointer p-2 rounded-md hover:bg-(--color-bg) transition-colors mb-6"
                @click="openLink(feedbackLink.url)">
                <div class="flex items-center space-x-3">
                    <span class="text-lg">{{ feedbackLink.icon }}</span>
                    <div>
                        <div class="text-sm text-(--color-text-primary)">{{ feedbackLink.name }}</div>
                        <div class="text-xs text-(--color-text-secondary)">{{ feedbackLink.url }}</div>
                    </div>
                </div>
                <el-icon class="text-(--color-text-secondary)"><Link /></el-icon>
            </div>
            <div class="flex flex-wrap justify-center gap-8">
                <!-- QQ 群 -->
                <div class="flex flex-col items-center space-y-2">
                    <img :src="qqQrcodePath" alt="QQ群二维码" class="w-36 h-36 rounded-lg shadow-sm" />
                    <span class="text-sm font-medium text-(--color-text-primary)">🐧 QQ 群：1047993501</span>
                </div>
                <!-- 微信群 -->
                <div class="flex flex-col items-center space-y-2">
                    <img :src="wxGroupQrcodePath" alt="微信群二维码" class="w-36 h-36 rounded-lg shadow-sm" />
                    <span class="text-sm font-medium text-(--color-text-primary)">💬 微信群</span>
                </div>
                <!-- 公众号 -->
                <div class="flex flex-col items-center space-y-2">
                    <img :src="wxPublicQrcodePath" alt="公众号二维码" class="w-36 h-36 rounded-lg shadow-sm" />
                    <span class="text-sm font-medium text-(--color-text-primary)">📱 公众号：{{ t('settings.system.community.officialAccountName') }}</span>
                </div>
            </div>
        </div>

        <!-- Star 支持 -->
        <div class="w-full bg-(--color-surface-elevated) rounded-lg p-6 border border-(--color-border) mt-4">
            <div class="text-center">
                <p class="text-sm text-(--color-text-secondary)">{{ t('settings.system.community.starPrompt') }}</p>
                <div class="mt-3 flex justify-center gap-3">
                    <el-button size="small" @click="openLink('https://gitee.com/zhendongdong/guada_ai')">
                        ⭐ Gitee
                    </el-button>
                    <el-button size="small" @click="openLink('https://github.com/donggua-zen/guada')">
                        ⭐ GitHub
                    </el-button>
                    <el-button size="small" @click="openLink('https://atomgit.com/donggua_sherlock/GuaDaAI')">
                        ⭐ GitCode
                    </el-button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElIcon, ElButton } from 'element-plus'
import { Link } from '@element-plus/icons-vue'
import { fixFrontendAssetUrl } from '@/utils/url'
import { openInExternalBrowser } from '@/utils/browserUtils'

const { t } = useI18n()

const qqQrcodePath = computed(() => fixFrontendAssetUrl('/images/qq_qrcode.png'))
const wxGroupQrcodePath = computed(() => fixFrontendAssetUrl('/images/wx_qun_qrcode.png'))
const wxPublicQrcodePath = computed(() => fixFrontendAssetUrl('/images/wx_public_qrcode.jpeg'))

const feedbackLink = {
    name: t('settings.system.community.giteeIssues'),
    url: 'https://gitee.com/zhendongdong/guada_ai/issues',
    icon: '💬',
}

const openLink = (url: string) => {
    openInExternalBrowser(url)
}
</script>

<style scoped>
.community-panel {
    height: 100%;
    overflow-y: auto;
}
</style>