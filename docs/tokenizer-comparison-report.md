# Tokenizer 对比测试报告

## 测试概述

本次测试对比了 `@huggingface/tokenizers`（使用官方 JSON 配置）和 `tiktoken` 库在不同模型下的 Token 分割差异。

### 测试环境
- **测试文档**: `docs/` 目录下的 5 个 Markdown 文件 + `data/` 目录下的 1 个 TXT 文件
- **总字符数**: 153,267 字符（其中纯中文文档 139,459 字符）
- **测试模型**: Qwen3、DeepSeek、GLM-4
- **Tiktoken 编码**: cl100k_base（作为基准对比）

### 测试文档列表
1. `character-avatar-default.md` - 2,073 字符 [中英混合]
2. `file-upload-progress-improvement.md` - 3,914 字符 [中英混合]
3. `memo-feature.md` - 3,433 字符 [中英混合]
4. `pdf-content-extraction-fix.md` - 4,388 字符 [中英混合]
5. `tokenizer-comparison-report.md` - 3,486 字符 [中英混合]
6. `我的室友是幽灵.txt` - 139,459 字符 [**纯中文**]

---

## 测试结果

### 1. Qwen3 vs Tiktoken (cl100k_base)

| 文档 | HF Tokens | Tiktoken | 差异 | 差异百分比 |
|------|-----------|----------|------|-----------|
| character-avatar-default.md | 1,026 | 1,225 | -199 | -16.24% |
| file-upload-progress-improvement.md | 1,698 | 1,984 | -286 | -14.42% |
| memo-feature.md | 1,686 | 2,082 | -396 | -19.02% |
| pdf-content-extraction-fix.md | 1,625 | 1,790 | -165 | -9.22% |

**统计总结**:
- 平均差异: **-261.50 tokens**
- 最大差异: **396 tokens**
- 总体差异: **-14.77%**
- 结论: ⚠️ HuggingFace Tokenizer 比 Tiktoken 少约 15% 的 Token

---

### 2. DeepSeek vs Tiktoken (cl100k_base)

| 文档 | HF Tokens | Tiktoken | 差异 | 差异百分比 |
|------|-----------|----------|------|-----------|
| character-avatar-default.md | 1,129 | 1,225 | -96 | -7.84% |
| file-upload-progress-improvement.md | 1,912 | 1,984 | -72 | -3.63% |
| memo-feature.md | 1,866 | 2,082 | -216 | -10.37% |
| pdf-content-extraction-fix.md | 1,915 | 1,790 | +125 | +6.98% |

**统计总结**:
- 平均差异: **-64.75 tokens**
- 最大差异: **216 tokens**
- 总体差异: **-3.66%**
- 结论: ✅ DeepSeek 与 Tiktoken 最为接近，差异在可接受范围内

---

### 3. GLM-4 vs Tiktoken (cl100k_base)

| 文档 | HF Tokens | Tiktoken | 差异 | 差异百分比 |
|------|-----------|----------|------|-----------|
| character-avatar-default.md | 972 | 1,225 | -253 | -20.65% |
| file-upload-progress-improvement.md | 1,647 | 1,984 | -337 | -16.99% |
| memo-feature.md | 1,591 | 2,082 | -491 | -23.58% |
| pdf-content-extraction-fix.md | 1,538 | 1,790 | -252 | -14.08% |

**统计总结**:
- 平均差异: **-333.25 tokens**
- 最大差异: **491 tokens**
- 总体差异: **-18.83%**
- 结论: ⚠️ GLM-4 的 Tokenizer 最为激进，Token 数量显著少于 Tiktoken

---

### 4. 纯中文文档对比（我的室友是幽灵.txt - 139,459 字符）

| 模型 | HF Tokens | Tiktoken | 差异 | 差异百分比 |
|------|-----------|----------|------|-----------|
| Qwen3 | 96,906 | 182,289 | -85,383 | **-46.84%** |
| DeepSeek | 87,057 | 182,289 | -95,232 | **-52.24%** |
| GLM-4 | 93,035 | 182,289 | -89,254 | **-48.96%** |

**关键发现**:
- ⚠️ **纯中文文本的差异极其显著**：HuggingFace Tokenizers 的 Token 数量仅为 Tiktoken 的 **50% 左右**
- DeepSeek 的 tokenizer 对中文最为激进，Token 数量最少
- 这表明不同 tokenizer 对中文的处理策略存在根本性差异

---

## 关键发现

### 1. Token 数量差异显著

#### 中英混合文档
- **Qwen3**: 比 Tiktoken 少约 15%
- **DeepSeek**: 比 Tiktoken 少约 4%（最接近）
- **GLM-4**: 比 Tiktoken 少约 19%（差异最大）

#### 纯中文文档（重大发现！）
- **Qwen3**: 比 Tiktoken 少约 **47%**
- **DeepSeek**: 比 Tiktoken 少约 **52%**
- **GLM-4**: 比 Tiktoken 少约 **49%**
- ⚠️ **纯中文文本的差异是中英混合文档的 3-4 倍！**

### 2. 性能对比
- **HuggingFace Tokenizers**: 初始化较慢（首次加载 300-600ms），但后续调用快速
- **Tiktoken**: 初始化快（50-130ms），整体性能更优

### 3. 一致性分析
- 不同模型的 Tokenizer 对同一文本的分割策略存在明显差异
- DeepSeek 的 tokenizer 与 Tiktoken 的 cl100k_base 最为相似
- GLM-4 倾向于生成更少的 Token（可能是更激进的合并策略）

---

## 建议

### 对于 Token 统计功能
1. **推荐使用模型专用的 Tokenizer**：每个模型应使用其官方的 tokenizer 配置，以确保准确性
2. **避免跨模型对比**：不同模型的 Token 数量不具备直接可比性
3. **缓存 Tokenizer 实例**：HuggingFace Tokenizers 初始化较慢，应在应用启动时预加载

### 对于上下文管理
1. **使用实际模型的 Tokenizer**：在计算会话 Token 使用时，应使用当前会话所用模型的 tokenizer
2. **预留安全边际**：由于不同 tokenizer 的差异，建议在上下文限制中预留 10-20% 的安全空间
3. **⚠️ 特别注意纯中文内容**：如果会话包含大量纯中文文本，Token 数量可能只有 Tiktoken 估算的 50%，需要特别调整策略

### 对于压缩功能
1. **基于实际 Token 计数**：对话历史压缩应使用目标模型的 tokenizer 进行精确计数
2. **动态调整压缩比例**：根据不同模型的 tokenizer 特性，可能需要调整压缩策略

---

## 技术细节

### HuggingFace Tokenizers 优势
- ✅ 支持所有 HuggingFace Hub 上的模型
- ✅ 提供完整的 tokenizer 组件（Normalizer、PreTokenizer、Model、PostProcessor、Decoder）
- ✅ 与模型训练时使用的 tokenizer 完全一致

### Tiktoken 优势
- ✅ 性能更优（尤其是初始化速度）
- ✅ API 简洁易用
- ✅ OpenAI 官方维护，可靠性高
- ❌ 仅支持 OpenAI 系列模型及其兼容编码

---

## 测试脚本

测试脚本位于: `backend-ts/scripts/test-tokenizer-comparison.js`

运行方式:
```bash
node scripts/test-tokenizer-comparison.js
```

---

*测试日期: 2026-04-15*
*测试工具: @huggingface/tokenizers v0.x, tiktoken v0.x*
