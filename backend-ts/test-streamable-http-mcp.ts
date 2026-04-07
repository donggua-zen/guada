/**
 * StreamableHTTP MCP 客户端测试脚本
 * 
 * 使用官方的 StreamableHTTPClientTransport 测试阿里云百炼 MCP 服务
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function testStreamableHttpMcp() {
    console.log('=== StreamableHTTP MCP Client Test ===\n');

    // 阿里云百炼 MCP 配置
    const config = {
        url: 'https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp',
        headers: {
            'Authorization': 'Bearer sk-b4ed412869c342b5b50a0f3177af5d5c',
        }
    };

    let client: Client | null = null;

    try {
        console.log('1. Initializing StreamableHTTPClientTransport...');
        console.log(`   URL: ${config.url}`);
        
        // 创建传输层
        const transport = new StreamableHTTPClientTransport(new URL(config.url), {
            requestInit: {
                headers: config.headers,
            },
        });

        console.log('   ✅ Transport created\n');

        // 创建客户端
        console.log('2. Creating MCP Client...');
        client = new Client({ 
            name: 'test-client', 
            version: '1.0.0' 
        });

        console.log('   ✅ Client created\n');

        // 连接服务器
        console.log('3. Connecting to MCP server...');
        await client.connect(transport);
        console.log('   ✅ Connected successfully\n');

        // 获取工具列表
        console.log('4. Fetching tools list...');
        const toolsResult = await client.listTools();
        console.log(`   Found ${toolsResult.tools?.length || 0} tools`);
        
        if (toolsResult.tools && toolsResult.tools.length > 0) {
            console.log('\n   Available tools:');
            toolsResult.tools.forEach((tool: any, index: number) => {
                console.log(`     ${index + 1}. ${tool.name}`);
                console.log(`        Description: ${tool.description || 'N/A'}`);
                if (tool.inputSchema) {
                    console.log(`        Parameters: ${JSON.stringify(tool.inputSchema.properties || {}, null, 2).split('\n').map(l => '          ' + l).join('\n')}`);
                }
                console.log('');
            });
        } else {
            console.log('   ⚠️  No tools found\n');
        }

        // 如果有工具，尝试调用第一个
        if (toolsResult.tools && toolsResult.tools.length > 0) {
            const firstTool = toolsResult.tools[0];
            console.log(`5. Testing tool call: ${firstTool.name}...`);
            
            // 根据工具的 inputSchema 构造合适的参数
            let toolArgs: Record<string, any> = {};
            
            // 如果是搜索工具，尝试提供查询参数
            if (firstTool.name.toLowerCase().includes('search')) {
                toolArgs = {
                    query: '测试搜索',
                };
            }

            console.log(`   Arguments: ${JSON.stringify(toolArgs)}`);

            try {
                const callResult = await client.callTool({
                    name: firstTool.name,
                    arguments: toolArgs,
                });

                console.log('   ✅ Tool call succeeded');
                console.log('   Result type:', typeof callResult);
                console.log('   Result preview:', JSON.stringify(callResult, null, 2).substring(0, 500));
            } catch (callError: any) {
                console.log('   ❌ Tool call failed');
                console.log('   Error message:', callError.message);
                console.log('   Error details:', callError);
            }
        }

        console.log('\n=== Test completed successfully ===');
    } catch (error: any) {
        console.error('\n❌ Test failed with error:');
        console.error('   Message:', error.message);
        console.error('   Name:', error.name);
        console.error('   Stack:', error.stack);
        
        // 如果是 HTTP 错误，尝试获取更多信息
        if (error.response) {
            console.error('   Response status:', error.response.status);
            console.error('   Response data:', error.response.data);
        }
    } finally {
        // 关闭连接
        if (client) {
            try {
                console.log('\n6. Closing connection...');
                await client.close();
                console.log('   ✅ Connection closed');
            } catch (closeError: any) {
                console.error('   ⚠️  Failed to close connection:', closeError.message);
            }
        }
    }
}

// 运行测试
testStreamableHttpMcp().catch(console.error);
