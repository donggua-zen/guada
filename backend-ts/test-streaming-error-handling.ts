/**
 * 流式响应异常处理测试脚本
 * 
 * 此脚本用于验证 agent.service.ts 和 llm.service.ts 中的异常处理逻辑是否正确工作。
 * 
 * 使用方法：
 * 1. 确保后端服务正在运行
 * 2. 运行此脚本：npx ts-node test-streaming-error-handling.ts
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api/v1/chat';

// 模拟不同的错误场景
async function testUserAbort() {
    console.log('\n🧪 测试 1: 用户主动中止');
    console.log('=====================================');
    
    try {
        // 创建一个会立即断开的请求
        const controller = new AbortController();
        
        const response = await fetch(`${BASE_URL}/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer YOUR_TOKEN_HERE', // 替换为实际的 token
            },
            body: JSON.stringify({
                sessionId: 'test-session-id',
                messageId: 'test-message-id',
                regenerationMode: 'overwrite',
            }),
            signal: controller.signal,
        });

        // 读取一部分数据后立即中止
        const reader = response.body?.getReader();
        if (reader) {
            await reader.read(); // 读取第一个 chunk
            console.log('✅ 接收到第一个 chunk，现在中止请求...');
            controller.abort(); // 主动中止
            
            // 尝试继续读取（应该会失败）
            try {
                await reader.read();
            } catch (error: any) {
                console.log('✅ 请求已中止:', error.message);
            }
        }
        
        console.log('✅ 测试完成：用户中止场景已触发');
    } catch (error: any) {
        console.error('❌ 测试失败:', error.message);
    }
}

async function testTimeout() {
    console.log('\n🧪 测试 2: 请求超时');
    console.log('=====================================');
    
    try {
        // 设置一个非常短的超时时间
        const response = await axios.post(
            `${BASE_URL}/stream`,
            {
                sessionId: 'test-session-id',
                messageId: 'test-message-id',
                regenerationMode: 'overwrite',
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer YOUR_TOKEN_HERE', // 替换为实际的 token
                },
                timeout: 100, // 100ms 超时
                responseType: 'stream',
            }
        );
        
        console.log('❌ 应该超时但没有超时');
    } catch (error: any) {
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            console.log('✅ 测试完成：超时场景已触发');
            console.log('   错误信息:', error.message);
        } else {
            console.error('❌ 非预期的错误:', error.message);
        }
    }
}

async function testInvalidSession() {
    console.log('\n🧪 测试 3: 无效的会话 ID');
    console.log('=====================================');
    
    try {
        const response = await axios.post(
            `${BASE_URL}/stream`,
            {
                sessionId: 'invalid-session-id',
                messageId: 'test-message-id',
                regenerationMode: 'overwrite',
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer YOUR_TOKEN_HERE', // 替换为实际的 token
                },
            }
        );
        
        console.log('❌ 应该返回错误但没有');
    } catch (error: any) {
        if (error.response) {
            console.log('✅ 测试完成：收到预期的错误响应');
            console.log('   状态码:', error.response.status);
            console.log('   错误信息:', error.response.data);
        } else {
            console.error('❌ 非预期的错误:', error.message);
        }
    }
}

async function verifyDatabaseRecords() {
    console.log('\n🧪 测试 4: 验证数据库记录');
    console.log('=====================================');
    console.log('提示：请手动执行以下 SQL 查询来验证异常处理是否正确保存了数据：');
    console.log('');
    console.log('-- 查看所有带有错误信息的消息内容');
    console.log("SELECT id, finish_reason, meta_data FROM message_contents WHERE meta_data->>'error' IS NOT NULL ORDER BY created_at DESC LIMIT 10;");
    console.log('');
    console.log('-- 查看用户中止的记录');
    console.log("SELECT id, finish_reason, meta_data FROM message_contents WHERE meta_data->>'error' LIKE '%abort%' ORDER BY created_at DESC LIMIT 5;");
    console.log('');
    console.log('-- 查看超时的记录');
    console.log("SELECT id, finish_reason, meta_data FROM message_contents WHERE finish_reason = 'timeout' ORDER BY created_at DESC LIMIT 5;");
    console.log('');
    console.log('✅ 如果能看到相关记录，说明异常处理和数据保存正常工作');
}

async function main() {
    console.log('='.repeat(60));
    console.log('流式响应异常处理测试');
    console.log('='.repeat(60));
    
    console.log('\n⚠️  注意：在运行测试之前，请确保：');
    console.log('1. 后端服务正在运行 (npm run start:dev)');
    console.log('2. 已将 YOUR_TOKEN_HERE 替换为实际的认证 token');
    console.log('3. 数据库中已有测试用的 session 和 message');
    
    console.log('\n按回车键开始测试...');
    process.stdin.once('data', async () => {
        // 运行测试
        await testInvalidSession();
        await testUserAbort();
        await testTimeout();
        await verifyDatabaseRecords();
        
        console.log('\n' + '='.repeat(60));
        console.log('测试完成！');
        console.log('='.repeat(60));
        console.log('\n📖 详细的测试报告请查看: docs/STREAMING_ERROR_HANDLING_IMPROVEMENT.md');
        console.log('\n💡 建议：');
        console.log('   - 检查日志文件确认错误分类是否正确');
        console.log('   - 查询数据库验证 metaData.error 字段是否有值');
        console.log('   - 观察前端是否能正确显示错误提示');
    });
}

main().catch(console.error);
