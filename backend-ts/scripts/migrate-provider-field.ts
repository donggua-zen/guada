/**
 * 数据迁移脚本：修复供应商 provider 字段
 * 
 * 用途：将现有的 provider 字段值更新为正确的标识符
 * 运行方式：npx ts-node scripts/migrate-provider-field.ts
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

// 供应商标识符映射表
const PROVIDER_NAME_TO_ID: Record<string, string> = {
  '硅基流动': 'siliconflow',
  'OpenAI': 'openai',
  'DeepSeek': 'deepseek',
  'Anthropic': 'anthropic',
  // 可以根据实际情况添加更多映射
};

async function migrateProviderField() {
  console.log('\n🔄 开始迁移供应商 provider 字段...\n');

  try {
    // 1. 获取所有供应商
    const providers = await prisma.modelProvider.findMany({
      select: {
        id: true,
        name: true,
        provider: true,
        protocol: true,
      },
    });

    console.log(`📋 找到 ${providers.length} 个供应商\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // 2. 逐个处理
    for (const provider of providers) {
      const currentProvider = provider.provider;
      let newProviderValue: string | null = null;

      // 判断是否需要更新
      if (!currentProvider || currentProvider === '') {
        // provider 为空，需要根据名称推断
        newProviderValue = PROVIDER_NAME_TO_ID[provider.name] || 'custom';
        console.log(`   📝 ${provider.name}: provider 为空 → "${newProviderValue}"`);
      } else if (Object.values(PROVIDER_NAME_TO_ID).includes(currentProvider)) {
        // provider 已经是正确的标识符，跳过
        console.log(`   ✅ ${provider.name}: provider 已正确 ("${currentProvider}")`);
        skippedCount++;
        continue;
      } else if (PROVIDER_NAME_TO_ID[currentProvider]) {
        // provider 是中文名称，需要转换为标识符
        newProviderValue = PROVIDER_NAME_TO_ID[currentProvider];
        console.log(`   🔄 ${provider.name}: "${currentProvider}" → "${newProviderValue}"`);
      } else {
        // 未知类型，标记为 custom
        console.log(`   ⚠️  ${provider.name}: 未知 provider "${currentProvider}" → "custom"`);
        newProviderValue = 'custom';
      }

      // 执行更新
      if (newProviderValue) {
        try {
          await prisma.modelProvider.update({
            where: { id: provider.id },
            data: { provider: newProviderValue },
          });
          updatedCount++;
        } catch (error) {
          console.error(`   ❌ 更新失败: ${provider.name}`, error);
          errorCount++;
        }
      }
    }

    // 3. 输出统计信息
    console.log('\n📊 迁移统计:');
    console.log(`   ✅ 成功更新: ${updatedCount} 个`);
    console.log(`   ⏭️  跳过（已正确）: ${skippedCount} 个`);
    console.log(`   ❌ 更新失败: ${errorCount} 个`);
    console.log(`   📈 总计处理: ${providers.length} 个`);

    if (errorCount > 0) {
      console.log('\n⚠️  有记录更新失败，请检查日志并手动修复');
    } else {
      console.log('\n✅ 迁移完成！所有供应商的 provider 字段已正确设置\n');
    }
  } catch (error) {
    console.error('❌ 迁移失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 运行迁移
migrateProviderField().catch((error) => {
  console.error('迁移脚本执行失败:', error);
  process.exit(1);
});
