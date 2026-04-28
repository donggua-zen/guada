/**
 * 企业微信适配器测试脚本
 * 
 * 使用方法：
 * 1. 确保后端服务正在运行 (npm run start:dev)
 * 2. 确保已创建企业微信机器人实例
 * 3. 运行此脚本进行测试
 */

import axios from 'axios';

// 配置
const API_BASE_URL = 'http://localhost:3000';
const JWT_TOKEN = 'YOUR_JWT_TOKEN_HERE'; // 替换为你的 JWT Token

// 企业微信机器人配置
const WECOM_CONFIG = {
  platform: 'wecom',
  name: '测试企业微信机器人',
  enabled: true,
  platformConfig: {
    corpId: 'wwxxxxxxxxxxxxxxxx', // 替换为你的企业 ID
    corpSecret: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // 替换为你的应用 Secret
    agentId: '1000001', // 替换为你的 AgentId
  },
  defaultCharacterId: 'test-character-id', // 替换为你的角色 ID
  reconnectConfig: {
    enabled: true,
    maxRetries: 5,
    retryInterval: 5000,
  },
};

/**
 * 创建企业微信机器人
 */
async function createWeComBot() {
  try {
    console.log('Creating WeCom bot...');
    const response = await axios.post(
      `${API_BASE_URL}/api/bots/admin/create`,
      WECOM_CONFIG,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );

    console.log('Bot created successfully:', response.data);
    return response.data.id;
  } catch (error: any) {
    console.error('Failed to create bot:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 启动机器人
 */
async function startBot(botId: string) {
  try {
    console.log(`Starting bot: ${botId}...`);
    const response = await axios.post(
      `${API_BASE_URL}/api/bots/admin/${botId}/start`,
      {},
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );

    console.log('Bot started successfully:', response.data);
  } catch (error: any) {
    console.error('Failed to start bot:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 获取机器人状态
 */
async function getBotStatus(botId: string) {
  try {
    console.log(`Getting bot status: ${botId}...`);
    const response = await axios.get(
      `${API_BASE_URL}/api/bots/admin/${botId}`,
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );

    console.log('Bot status:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('Failed to get bot status:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 停止机器人
 */
async function stopBot(botId: string) {
  try {
    console.log(`Stopping bot: ${botId}...`);
    const response = await axios.post(
      `${API_BASE_URL}/api/bots/admin/${botId}/stop`,
      {},
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );

    console.log('Bot stopped successfully:', response.data);
  } catch (error: any) {
    console.error('Failed to stop bot:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 删除机器人
 */
async function deleteBot(botId: string) {
  try {
    console.log(`Deleting bot: ${botId}...`);
    const response = await axios.delete(
      `${API_BASE_URL}/api/bots/admin/${botId}`,
      {
        headers: {
          Authorization: `Bearer ${JWT_TOKEN}`,
        },
      }
    );

    console.log('Bot deleted successfully:', response.data);
  } catch (error: any) {
    console.error('Failed to delete bot:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * 主测试流程
 */
async function main() {
  console.log('=== WeCom Bot Adapter Test ===\n');

  let botId: string | null = null;

  try {
    // 1. 创建机器人
    botId = await createWeComBot();
    console.log('\n✓ Step 1 completed: Bot created\n');

    // 等待一下
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. 启动机器人
    await startBot(botId);
    console.log('\n✓ Step 2 completed: Bot started\n');

    // 等待一下，让机器人完全启动
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 3. 检查状态
    await getBotStatus(botId);
    console.log('\n✓ Step 3 completed: Status checked\n');

    // 4. 停止机器人
    await stopBot(botId);
    console.log('\n✓ Step 4 completed: Bot stopped\n');

    // 5. 删除机器人（可选，如果需要清理）
    // await deleteBot(botId);
    // console.log('\n✓ Step 5 completed: Bot deleted\n');

    console.log('\n=== All tests passed! ===');
  } catch (error) {
    console.error('\n✗ Test failed:', error);

    // 如果出错，尝试清理
    if (botId) {
      try {
        await stopBot(botId);
        await deleteBot(botId);
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError);
      }
    }

    process.exit(1);
  }
}

// 运行测试
main().catch(console.error);
