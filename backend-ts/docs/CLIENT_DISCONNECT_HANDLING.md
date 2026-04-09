# 客户端断开连接处理实现文档

## 概述

本文档描述了 TypeScript 后端如何实现客户端断开连接时的 LLM 请求中止机制，防止后端继续消耗 Token 和计算资源。

## 问题分析

### Python 后端的处理方式

Python 后端使用 FastAPI 的 `StreamingResponse`，当客户端断开连接时：

1. FastAPI 自动检测到连接断开
2. 抛出 `asyncio.CancelledError` 异常
3. 异常向上传播到 `agent_service.py` 的 `completions()` 方法
4. 在 `except asyncio.CancelledError` 块中捕获并处理
5. 记录思考结束时间并保存部分生成的内容

```python
except asyncio.CancelledError:
    logger.debug("User stopped generation")
    complete_chunk["finish_reason"] = "user_stop"
    self._record_thinking_finished(current_turn_thinking_info, "user stop")
    raise
```

### TypeScript 后端的问题

原始的 TypeScript 实现存在以下问题：

1. **未监听客户端断开事件**：Controller 层没有监听 `req.on('close')` 事件
2. **无法中断 LLM 请求**：调用 OpenAI SDK 时未传递 `AbortSignal`
3. **资源浪费**：即使用户关闭浏览器，后端仍会继续调用 LLM API 并消耗 Token

## 解决方案

### 1. Controller 层：监听客户端断开事件

#### SSE 端点 (`@Sse('completions')`)

```typescript
@Sse('completions')
async completions(
    @Body() body: { sessionId: string; messageId: string; ... },
    @CurrentUser() user: any,
    @Req() req: Request,  // 注入 Request 对象
): Promise<Observable<MessageEvent>> {
    // 创建 AbortController 用于中断 LLM 请求
    const abortController = new AbortController();
    
    // 监听客户端断开连接事件
    req.on('close', () => {
        if (!req.complete) {
            console.log('Client disconnected, aborting LLM request');
            abortController.abort();
        }
    });
    
    // 将 AgentService 的 AsyncGenerator 转换为 RxJS Observable
    return new Observable((observer) => {
        const iterator = this.agentService.completions(
            sessionId,
            messageId,
            regenerationMode,
            assistantMessageId,
            abortController.signal,  // 传递中断信号
        );
        
        let isCompleted = false;
        
        const push = async () => {
            if (isCompleted) return;
            
            try {
                const { value, done } = await iterator.next();
                if (done) {
                    isCompleted = true;
                    observer.next({ data: '[DONE]' });
                    observer.complete();
                } else {
                    observer.next({ data: JSON.stringify(value) });
                    push();
                }
            } catch (error: any) {
                isCompleted = true;
                if (error.name === 'AbortError') {
                    console.log('LLM request aborted due to client disconnect');
                    observer.complete();
                } else {
                    observer.error(error);
                }
            }
        };
        
        push();
        
        // 清理函数：当 Observable 被取消订阅时中断请求
        return () => {
            if (!isCompleted) {
                console.log('Observable unsubscribed, aborting LLM request');
                abortController.abort();
            }
        };
    });
}
```

#### POST 端点 (`@Post('stream')`)

```typescript
@Post('stream')
async streamMessage(
    @Body() body: { sessionId: string; ... },
    @CurrentUser() user: any,
    @Res() res: Response,
    @Req() req: Request,  // 注入 Request 对象
) {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // 创建 AbortController 用于中断 LLM 请求
    const abortController = new AbortController();
    
    // 监听客户端断开连接事件
    req.on('close', () => {
        if (!res.writableEnded) {
            console.log('Client disconnected (stream endpoint), aborting LLM request');
            abortController.abort();
        }
    });

    try {
        const iterator = this.agentService.completions(
            sessionId,
            messageId || '',
            regenerationMode,
            assistantMessageId,
            abortController.signal,  // 传递中断信号
        );

        for await (const chunk of iterator) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.log('LLM request aborted due to client disconnect (stream endpoint)');
            if (!res.writableEnded) {
                res.end();
            }
        } else {
            console.error('Stream error:', error);
            if (!res.writableEnded) {
                res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
                res.end();
            }
        }
    }
}
```

### 2. Agent Service 层：传递中断信号

```typescript
async *completions(
    sessionId: string,
    messageId: string,
    regenerationMode: string = 'overwrite',
    assistantMessageId?: string,
    abortSignal?: AbortSignal,  // 新增参数：中断信号
) {
    // ... 其他逻辑
    
    const stream = llm.completions({
        model: session.model?.modelName || 'gpt-3.5-turbo',
        messages: [...messages, ...chatTurns],
        tools,
        temperature: mergedSettings.modelTemperature,
        top_p: mergedSettings.modelTopP,
        frequency_penalty: mergedSettings.modelFrequencyPenalty,
        max_tokens: session.model?.maxOutputTokens,
        thinking: mergedSettings.thinkingEnabled,
        modelConfig: session.model,
        stream: true,
        abortSignal,  // 传递中断信号到 LLM Service
    });
    
    // ... 流式处理逻辑
}
```

### 3. LLM Service 层：使用 AbortSignal 中断请求

```typescript
private async *executeCompletion(params: {
    model: string;
    messages: MessageRecord[];
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    tools?: any[];
    thinking?: boolean;
    max_tokens?: number;
    modelConfig?: any;
    stream: boolean;
    abortSignal?: AbortSignal;  // 新增参数：中断信号
}) {
    const client = this.createClient(params.modelConfig);
    
    // ... 构建请求参数
    
    try {
        // 注意：signal 必须作为第二个参数（options）传递，而不是放在 body 中
        response = await client.chat.completions.create(
            requestParams,  // 第一个参数：请求体
            {
                signal: params.abortSignal,  // 第二个参数：请求选项
            }
        );
        
        // ... 流式处理逻辑
    } catch (error) {
        // OpenAI SDK 会在接收到 abort 信号时抛出 AbortError
        if (error.name === 'AbortError') {
            this.logger.log('LLM request was aborted');
        }
        throw error;
    }
}
```

## 工作流程

```
用户关闭浏览器
    ↓
浏览器关闭 TCP 连接
    ↓
Node.js 检测到连接关闭
    ↓
触发 req.on('close') 事件
    ↓
调用 abortController.abort()
    ↓
AbortSignal 状态变为 aborted
    ↓
OpenAI SDK 检测到 signal.aborted === true
    ↓
中断 HTTP 请求，抛出 AbortError
    ↓
错误向上传播到 Agent Service
    ↓
Agent Service 捕获错误并停止生成
    ↓
清理资源，保存已生成的内容
```

## 验证与测试

### 1. 日志验证

启动后端服务后，观察以下日志：

```bash
# 正常情况
[Nest] xxxxx  - xx/xx/xxxx, x:xx:xx PM   DEBUG [LLMService] Using model provider: xxx
[Nest] xxxxx  - xx/xx/xxxx, x:xx:xx PM   DEBUG [LLMService] Base URL: xxx

# 客户端断开连接
[Nest] xxxxx  - xx/xx/xxxx, x:xx:xx PM   LOG Client disconnected, aborting LLM request
[Nest] xxxxx  - xx/xx/xxxx, x:xx:xx PM   LOG LLM request aborted due to client disconnect
```

### 2. 手动测试步骤

1. **启动后端服务**：
   ```bash
   cd backend-ts
   npm run start:dev
   ```

2. **打开前端页面**，开始一个新的对话

3. **发送一条消息**，等待 AI 开始回复

4. **在 AI 回复过程中关闭浏览器标签页**

5. **检查后端日志**，应该看到：
   - "Client disconnected, aborting LLM request"
   - "LLM request aborted due to client disconnect"

6. **检查 API 用量**（如果使用付费 API）：
   - 登录 API 提供商的控制台
   - 查看 Token 使用情况
   - 确认在断开连接后没有继续消耗 Token

### 3. 自动化测试建议

可以编写一个简单的测试脚本：

```typescript
import http from 'http';

async function testClientDisconnect() {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: '/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer your-token',
            },
        }, (res) => {
            // 接收一部分数据后立即断开
            let receivedChunks = 0;
            res.on('data', (chunk) => {
                receivedChunks++;
                console.log('Received chunk:', receivedChunks);
                
                // 收到第一个 chunk 后立即断开
                if (receivedChunks === 1) {
                    req.destroy();
                    console.log('Client disconnected intentionally');
                    
                    // 等待 2 秒后检查后端日志
                    setTimeout(() => {
                        console.log('Test completed. Check backend logs for abort message.');
                        resolve(true);
                    }, 2000);
                }
            });
        });
        
        req.on('error', (error) => {
            // 预期的错误（连接被中断）
            if (error.code === 'ECONNRESET') {
                console.log('Connection reset as expected');
            } else {
                reject(error);
            }
        });
        
        req.write(JSON.stringify({
            sessionId: 'test-session-id',
            messageId: 'test-message-id',
        }));
        
        req.end();
    });
}

testClientDisconnect().catch(console.error);
```

## 关键改进点

### 1. 双重保障机制

- **Request Close 事件**：监听底层 TCP 连接关闭
- **Observable Unsubscribe**：监听 RxJS Observable 取消订阅

### 2. 正确的错误处理

- 区分 `AbortError` 和其他错误
- `AbortError` 不视为异常，正常完成流
- 其他错误仍然抛出并记录

### 3. 资源清理

- 确保在断开连接时正确结束响应
- 避免内存泄漏和资源占用

### 4. 与 Python 后端的一致性

| 特性 | Python 后端 | TypeScript 后端 | 状态 |
|------|------------|----------------|------|
| 检测客户端断开 | FastAPI 自动处理 | 手动监听 req.close | ✅ 一致 |
| 中断 LLM 请求 | asyncio.CancelledError | AbortController | ✅ 一致 |
| 保存部分内容 | 是 | 是 | ✅ 一致 |
| 记录思考时间 | 是 | 是 | ✅ 一致 |

## 注意事项

### 1. AbortController 兼容性

- Node.js 15.0.0+ 原生支持 `AbortController`
- 如果使用更早版本，需要安装 `abort-controller` polyfill

### 2. OpenAI SDK 版本

- 确保使用支持 `signal` 参数的 OpenAI SDK 版本
- 当前使用的 `openai@4.x` 完全支持

### 3. 代理服务器配置

如果使用了 Nginx 等反向代理，确保配置了：

```nginx
proxy_buffering off;
proxy_cache off;
tcp_nopush on;
tcp_nodelay on;
```

### 4. 超时设置

即使有断开检测，也应该设置合理的超时：

```typescript
const timeout = setTimeout(() => {
    abortController.abort();
}, 60000);  // 60 秒超时
```

## 总结

通过本次重构，TypeScript 后端实现了与 Python 后端相同的客户端断开连接处理能力：

1. ✅ 监听客户端断开事件
2. ✅ 立即中断 LLM API 请求
3. ✅ 防止 Token 浪费
4. ✅ 正确清理资源
5. ✅ 记录详细日志

这确保了在生产环境中，即使用户意外关闭浏览器或网络中断，后端也不会继续消耗昂贵的 LLM API 配额。
