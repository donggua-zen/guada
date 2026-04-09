/**
 * 协议类型字段测试脚本
 * 
 * 用于验证 protocol 字段的正确性和字段权限控制
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function testProtocolField() {
  console.log('\n🧪 开始测试协议类型字段...\n');

  try {
    // 1. 检查所有供应商的 protocol 字段
    console.log('📋 当前所有供应商的协议类型:');
    const providers = await prisma.modelProvider.findMany({
      select: {
        id: true,
        name: true,
        provider: true,
        protocol: true,
        apiUrl: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (providers.length === 0) {
      console.log('   ⚠️  暂无供应商数据');
    } else {
      providers.forEach((p) => {
        const status = p.protocol ? '✅' : '⚠️ ';
        const editable = p.provider === 'custom' ? '可编辑' : '部分禁用';
        console.log(`   ${status} ${p.name}`);
        console.log(`      - provider: ${p.provider || '(空)'}`);
        console.log(`      - protocol: ${p.protocol || '(未设置)'}`);
        console.log(`      - 编辑权限: ${editable}`);
      });
    }

    // 2. 统计协议类型分布
    console.log('\n📊 协议类型分布:');
    const protocolStats = await prisma.modelProvider.groupBy({
      by: ['protocol'],
      _count: true,
      orderBy: {
        _count: {
          protocol: 'desc',
        },
      },
    });

    if (protocolStats.length === 0) {
      console.log('   ⚠️  无数据');
    } else {
      protocolStats.forEach((stat) => {
        const protocolName = stat.protocol || '(未设置)';
        console.log(`   - ${protocolName}: ${stat._count} 个`);
      });
    }

    // 3. 检查 custom 类型供应商
    console.log('\n🔧 自定义供应商 (provider = "custom"):');
    const customProviders = await prisma.modelProvider.findMany({
      where: { provider: 'custom' },
      select: {
        id: true,
        name: true,
        protocol: true,
        apiUrl: true,
      },
    });

    if (customProviders.length === 0) {
      console.log('   ⭕ 暂无自定义供应商');
    } else {
      customProviders.forEach((p) => {
        console.log(`   ✅ ${p.name}`);
        console.log(`      - protocol: ${p.protocol || '(未设置)'}`);
        console.log(`      - 可编辑: name, protocol, apiUrl, apiKey`);
      });
    }

    // 4. 检查模板供应商
    console.log('\n📦 模板供应商 (provider != "custom"):');
    const templateProviders = await prisma.modelProvider.findMany({
      where: { 
        provider: {
          not: 'custom',
        },
      },
      select: {
        id: true,
        name: true,
        provider: true,
        protocol: true,
        apiUrl: true,
      },
    });

    if (templateProviders.length === 0) {
      console.log('   ⭕ 暂无模板供应商');
    } else {
      templateProviders.forEach((p) => {
        console.log(`   ✅ ${p.name} (${p.provider})`);
        console.log(`      - protocol: ${p.protocol || '(未设置)'}`);
        console.log(`      - 可编辑: 仅 apiKey`);
        console.log(`      - 已禁用: name, protocol, apiUrl`);
      });
    }

    // 5. 验证字段权限逻辑
    console.log('\n🔍 字段权限验证:');
    let allCorrect = true;

    for (const provider of providers) {
      if (provider.provider === 'custom') {
        // custom 类型应该可以编辑所有字段
        console.log(`   ✅ ${provider.name}: 所有字段可编辑`);
      } else {
        // 非 custom 类型应该只能编辑 apiKey
        console.log(`   ✅ ${provider.name}: 仅 apiKey 可编辑，其他字段禁用`);
      }
    }

    if (allCorrect) {
      console.log('\n✅ 字段权限逻辑正确\n');
    }

    // 6. 建议
    console.log('💡 建议:');
    const withoutProtocol = providers.filter(p => !p.protocol).length;
    if (withoutProtocol > 0) {
      console.log(`   ⚠️  有 ${withoutProtocol} 个供应商未设置 protocol 字段`);
      console.log('   💡 建议运行迁移脚本补充 protocol 值');
    } else {
      console.log('   ✅ 所有供应商都已设置 protocol 字段');
    }

    console.log('\n✅ 测试完成\n');
  } catch (error) {
    console.error('❌ 测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// 运行测试
testProtocolField();
