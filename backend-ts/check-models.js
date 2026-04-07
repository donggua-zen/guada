const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const models = await prisma.model.findMany({
      include: { provider: true },
      take: 5,
    });
    
    console.log('=== Models with Providers ===');
    models.forEach((model, index) => {
      console.log(`\n[${index + 1}] Model: ${model.modelName}`);
      console.log(`    Provider: ${model.provider?.name}`);
      console.log(`    API URL: ${model.provider?.apiUrl}`);
      console.log(`    API Key: ${model.provider?.apiKey ? '***' + model.provider.apiKey.slice(-4) : 'NOT SET'}`);
    });
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
