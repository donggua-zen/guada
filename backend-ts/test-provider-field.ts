/**
 * 供应商管理功能测试脚本
 * 
 * 用于验证 provider 字段的正确性
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function testProviderField() {
  console.log('\n🧪 开始测试供应商 provider 字段...\n');

  try {
    // 1. 检查现有供应商的 provider 字段
    console.log('📋 当前所有供应商:');
    const providers = await prisma.modelProvider.findMany({
      select: {
        id: true,
        name: true,
        provider: true,
        protocol: true,
        apiUrl: true,
      },
    });

    if (providers.length === 0) {
      console.log('   ⚠️  暂无供应商数据');
    } else {
      providers.forEach((p) => {
        const status = p.provider ? '✅' : '❌';
        console.log(`   ${status} ${p.name}`);
        console.log(`      - provider: ${p.provider || '(空)'}`);
        console.log(`      - protocol: ${p.protocol || '(空)'}`);
      });
    }

    // 2. 统计不同类型的供应商
    console.log('\n📊 供应商标识符分布:');
    const providerTypes = await prisma.modelProvider.groupBy({
      by: ['provider'],
      _count: true,
    });

    if (providerTypes.length === 0) {
      console.log('   ⚠️  无数据');
    } else {
      providerTypes.forEach((pt) => {
        console.log(`   - ${pt.provider || '(未设置)'}: ${pt._count} 个`);
      });
    }

    // 3. 验证模板对应的供应商
    console.log('\n🔍 验证模板供应商:');
    const templateIds = ['siliconflow', 'openai', 'deepseek', 'anthropic'];
    
    for (const templateId of templateIds) {
      const count = await prisma.modelProvider.count({
        where: { provider: templateId },
      });
      const status = count > 0 ? '✅ 已添加' : '⭕ 未添加';
      console.log(`   ${status}: ${templateId} (${count} 个)`);
    }

    // 4. 检查自定义供应商
    console.log('\n🔧 自定义供应商:');
    const customCount = await prisma.modelProvider.count({
      where: { provider: 'custom' },
    });
    console.log(`   数量: ${customCount} 个`);

    // 5. 检查是否有 provider 为空的记录
    console.log('\n⚠️  需要修复的记录:');
    const emptyProviders = await prisma.modelProvider.count({
      where: {
        provider: '',
      },
    });
    
    if (emptyProviders > 0) {
      console.log(`   ❌ 发现 ${emptyProviders} 条记录的 provider 字段为空`);
      console.log('   💡 建议运行数据迁移脚本修复');
    } else {
      console.log('   ✅ 所有记录的 provider 字段都已设置');
    }

    console.log('\n✅ 测试完成\n');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// 运行测试
testProviderField();
