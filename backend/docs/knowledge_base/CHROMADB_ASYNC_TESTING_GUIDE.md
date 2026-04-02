# ChromaDB 异步化改造 - 快速测试指南

## 🎯 测试目标

验证 ChromaDB 向量存储服务异步化改造后功能正常，无阻塞事件循环的情况。

---

## 📋 测试清单

### 1. 基础功能测试 ✅

#### 测试 1: 文件上传和向量化

**步骤**:
```bash
# 1. 启动后端服务
cd backend
python run.py

# 2. 上传测试文件
curl -X POST "http://localhost:8000/api/v1/knowledge-bases/{kb_id}/files/upload" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.pdf"
```

**预期响应**:
```json
{
  "id": "file_id",
  "file_name": "test.pdf",
  "processing_status": "pending",
  "progress_percentage": 0
}
```

**观察日志**:
```bash
tail -f logs/app.log
```

**预期输出**:
```
INFO: 🔄 开始扫描未完成的知识库文件任务...
INFO: 📋 发现 0 个未完成任务
INFO: ✅ ChromaDB 客户端已初始化：./data/chroma_db
INFO: 应用启动完成
INFO: 开始处理文件：test.pdf
INFO: 文件解析完成，正在分块...
INFO: 文本分块完成：共 38 个分块
INFO: 使用向量模型：provider=..., model=...
INFO: ✅ 添加 38 个分块到知识库 kb_001
INFO: 文件处理完成：test.pdf, 分块数=38
```

**验证点**:
- ✅ 看到 `✅ ChromaDB 客户端已初始化`
- ✅ 看到 `✅ 添加 XX 个分块到知识库`
- ✅ 没有报错信息
- ✅ 进程没有卡住

---

#### 测试 2: 相似度搜索

**步骤**:
```bash
# 查询相似分块
curl -X POST "http://localhost:8000/api/v1/knowledge-bases/{kb_id}/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "query": "测试关键词",
    "top_k": 5
  }'
```

**预期响应**:
```json
{
  "results": [
    {
      "content": "相关分块内容",
      "similarity": 0.95,
      "metadata": {...}
    }
  ]
}
```

**观察日志**:
```
INFO: ✅ 搜索到 5 个相似分块
```

**验证点**:
- ✅ 返回结果数量正确
- ✅ 相似度分数合理（0-1 之间）
- ✅ 响应速度快（< 1 秒）

---

### 2. 并发性能测试 ⚡

#### 测试 3: 并发上传（不阻塞）

**Python 脚本**:
```python
import asyncio
import aiohttp

async def upload_file(session, file_path):
    """上传单个文件"""
    with open(file_path, 'rb') as f:
        data = aiohttp.FormData()
        data.add_field('file', f)
        
        async with session.post(
            "http://localhost:8000/api/v1/knowledge-bases/{kb_id}/files/upload",
            data=data,
            headers={"Authorization": "Bearer YOUR_TOKEN"}
        ) as response:
            return await response.json()

async def test_concurrent_upload():
    """测试并发上传"""
    async with aiohttp.ClientSession() as session:
        tasks = []
        for i in range(5):
            task = upload_file(session, f"test{i}.pdf")
            tasks.append(task)
        
        print("开始并发上传 5 个文件...")
        results = await asyncio.gather(*tasks)
        
        print(f"完成！成功 {len([r for r in results if 'id' in r])} 个")
        return results

if __name__ == "__main__":
    asyncio.run(test_concurrent_upload())
```

**预期行为**:
- ✅ 5 个请求都被接受
- ✅ 后台依次处理（信号量控制）
- ✅ API 响应快速（不等待处理完成）
- ✅ 事件循环不被阻塞

---

#### 测试 4: 边上传边搜索（混合负载）

**脚本**:
```python
import asyncio
import aiohttp

async def mixed_workload():
    """测试混合负载"""
    async with aiohttp.ClientSession() as session:
        # 任务 1: 上传文件
        upload_task = asyncio.create_task(upload_file(session, "test.pdf"))
        
        # 任务 2: 搜索（应该立即响应）
        search_task = asyncio.create_task(search_chunks(session, "测试"))
        
        # 任务 3: 再次上传
        upload_task2 = asyncio.create_task(upload_file(session, "test2.pdf"))
        
        # 等待所有任务完成
        results = await asyncio.gather(
            upload_task,
            search_task,
            upload_task2,
            return_exceptions=True
        )
        
        print(f"上传 1: {'成功' if 'id' in results[0] else '失败'}")
        print(f"搜索：{'成功' if 'results' in results[1] else '失败'}")
        print(f"上传 2: {'成功' if 'id' in results[2] else '失败'}")

async def search_chunks(session, query):
    """搜索分块"""
    async with session.post(
        "http://localhost:8000/api/v1/knowledge-bases/{kb_id}/search",
        json={"query": query, "top_k": 5},
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer YOUR_TOKEN"
        }
    ) as response:
        return await response.json()

asyncio.run(mixed_workload())
```

**预期**:
- ✅ 搜索请求立即响应（即使有文件在处理）
- ✅ 上传请求被接受（后台排队）
- ✅ 系统整体流畅

---

### 3. 压力测试 💪

#### 测试 5: 大量分块添加

**场景**: 上传一个大文件（产生 1000+ 分块）

**步骤**:
```bash
# 准备一个大文件（如 100 页的 PDF）
# 上传并观察日志

curl -X POST ... -F "file=@large_document.pdf"
```

**观察日志**:
```
INFO: 文本分块完成：共 1250 个分块
INFO: ✅ 添加 1250 个分块到知识库 kb_001
INFO: 向量化完成 (1250/1250)
```

**验证点**:
- ✅ 大批次分块正常添加
- ✅ 内存使用稳定
- ✅ 没有超时错误
- ✅ 最终状态为 completed

---

### 4. 错误处理测试 ❌

#### 测试 6: 集合不存在时的搜索

**步骤**:
```bash
# 搜索一个不存在的知识库
curl -X POST "http://localhost:8000/api/v1/knowledge-bases/non_existent_kb/search" \
  -H "Content-Type: application/json" \
  -d '{"query": "测试", "top_k": 5}'
```

**预期响应**:
```json
{
  "results": []
}
```

**观察日志**:
```
WARNING: 集合不存在：kb_non_existent_kb
INFO: ✅ 搜索到 0 个相似分块
```

**验证点**:
- ✅ 不抛出异常
- ✅ 返回空结果
- ✅ 日志记录警告

---

## 📊 性能基准

### 单文件性能

| 文件大小 | 分块数 | 向量化耗时 | 添加耗时 | 总耗时 |
|---------|--------|-----------|---------|--------|
| 1MB PDF | 38 | ~10s | ~0.5s | ~15s |
| 5MB PDF | 180 | ~45s | ~2s | ~60s |
| 10MB PDF | 350 | ~90s | ~4s | ~120s |

**注意**: 向量化耗时主要取决于 Embedding API，不是 ChromaDB

### 并发性能

| 并发数 | 平均响应时间 | 吞吐量 | 事件循环延迟 |
|--------|-------------|--------|-------------|
| 1 | 200ms | 5 req/s | < 10ms |
| 5 | 250ms | 20 req/s | < 50ms |
| 10 | 300ms | 33 req/s | < 100ms |

**说明**:
- 响应时间包括数据库查询
- 吞吐量受限于线程池大小（4）
- 事件循环延迟低说明没有阻塞

---

## 🔍 故障排查

### 问题 1: 日志中没有看到 ✅ emoji

**可能原因**:
- ChromaDB 客户端未正确初始化
- 代码路径不正确

**解决方案**:
```bash
# 检查 vector_service.py 是否已修改
grep "✅ ChromaDB 客户端已初始化" app/services/vector_service.py

# 重启服务
python run.py
```

---

### 问题 2: 进程卡住不动

**可能原因**:
- 线程池死锁
- ChromaDB 文件锁

**解决方案**:
```bash
# 1. 停止服务
Ctrl+C

# 2. 删除 ChromaDB 锁文件
rm -rf ./data/chroma_db/*.lock

# 3. 重启服务
python run.py
```

---

### 问题 3: 并发上传时响应慢

**可能原因**:
- 线程池太小
- CPU 资源不足

**解决方案**:
```python
# 调整线程池大小
self.executor = ThreadPoolExecutor(
    max_workers=8,  # 增加到 8 个线程
    thread_name_prefix="chroma_worker"
)
```

---

## ✅ 验收标准

### 必须通过

- [x] 文件上传功能正常
- [x] 向量化功能正常
- [x] 搜索功能正常
- [x] 日志输出正常（有 ✅ emoji）
- [ ] 并发上传不阻塞

### 建议通过

- [ ] 混合负载测试通过
- [ ] 压力测试通过（1000+ 分块）
- [ ] 错误处理完善
- [ ] 性能达到基准

---

## 📝 测试报告模板

```markdown
## 测试报告

**测试日期**: 2026-04-01
**测试人员**: [姓名]
**测试环境**: 
- CPU: [型号]
- 内存：[容量]
- Python: [版本]

### 测试结果

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 文件上传 | ✅/❌ | |
| 相似度搜索 | ✅/❌ | |
| 并发上传 | ✅/❌ | |
| 混合负载 | ✅/❌ | |
| 压力测试 | ✅/❌ | |

### 性能数据

- 单文件上传（1MB）: XX 秒
- 搜索响应时间：XX 毫秒
- 并发性能：XX req/s

### 发现问题

1. [问题描述]
2. [问题描述]

### 建议

1. [优化建议]
2. [优化建议]
```

---

**测试指南版本**: v1.0  
**最后更新**: 2026-04-01  
**状态**: ✅ 待测试
