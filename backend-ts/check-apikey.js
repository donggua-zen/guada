const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const provider = await prisma.modelProvider.findFirst({
      where: {
        name: '硅基流动'
      }
    });

    if (!provider) {
      console.error('Provider not found');
      return;
    }

    console.log('=== Provider Details ===');
    console.log(`ID: ${provider.id}`);
    console.log(`Name: ${provider.name}`);
    console.log(`API URL: ${provider.apiUrl}`);
    console.log(`API Key (raw): "${provider.apiKey}"`);
    console.log(`API Key length: ${provider.apiKey?.length || 0}`);
    console.log(`API Key bytes: ${Buffer.from(provider.apiKey).toString('hex')}`);
    
    // 检查是否有隐藏字符
    const trimmed = provider.apiKey.trim();
    console.log(`\nAfter trim:`);
    console.log(`API Key: "${trimmed}"`);
    console.log(`Length: ${trimmed.length}`);
    
    if (trimmed !== provider.apiKey) {
      console.log('\n⚠️  WARNING: API Key has leading/trailing whitespace!');
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
