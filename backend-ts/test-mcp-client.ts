/**
 * MCP 客户端服务测试脚本
 * 
 * 用于验证 MCP 客户端的基本功能
 */

import { McpClientService } from './src/common/mcp/mcp-client.service';

async function testMcpClient() {
    console.log('=== MCP Client Service Test ===\n');

    // 创建服务实例（注意：在实际应用中应该通过 NestJS 依赖注入）
    const mcpClient = new McpClientService();

    // 测试配置 - 请根据实际情况修改
    const testConfig = {
        url: process.env.MCP_SERVER_URL || 'http://localhost:8080/mcp',
        headers: {
            // 如果需要认证，在这里添加
            // 'Authorization': 'Bearer your-token'
        }
    };

    console.log('Testing with MCP server:', testConfig.url);
    console.log('');

    try {
        // 1. 测试健康检查
        console.log('1. Testing health check...');
        const isHealthy = await mcpClient.healthCheck(testConfig);
        console.log(`   Health check result: ${isHealthy ? '✅ PASS' : '❌ FAIL'}`);
        console.log('');

        if (!isHealthy) {
            console.error('Server is not healthy. Aborting further tests.');
            return;
        }

        // 2. 测试获取工具列表
        console.log('2. Testing listTools...');
        const tools = await mcpClient.listTools(testConfig);
        console.log(`   Found ${Object.keys(tools).length} tools`);
        
        if (Object.keys(tools).length > 0) {
            console.log('   Tools:');
            Object.keys(tools).forEach(toolName => {
                console.log(`     - ${toolName}`);
            });
        }
        console.log('');

        // 3. 如果有工具，测试调用其中一个
        const firstToolName = Object.keys(tools)[0];
        if (firstToolName) {
            console.log(`3. Testing callTool with '${firstToolName}'...`);
            
            // 根据工具的 inputSchema 构造参数（这里使用空对象作为示例）
            const toolArgs = {};
            
            const result = await mcpClient.callTool(
                testConfig,
                firstToolName,
                toolArgs
            );

            if (result.success) {
                console.log('   ✅ Tool call succeeded');
                console.log('   Result:', (result.content || '').substring(0, 200));
            } else {
                console.log('   ❌ Tool call failed');
                console.log('   Error:', result.error);
            }
            console.log('');
        }

        console.log('=== All tests completed ===');
    } catch (error: any) {
        console.error('❌ Test failed with error:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// 运行测试
testMcpClient().catch(console.error);
