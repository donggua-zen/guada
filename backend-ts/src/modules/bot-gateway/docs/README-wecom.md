# 企业微信机器人适配器文档索引

## 📚 文档导航

### 🚀 快速开始
- [**5 分钟快速配置**](./wecom-quick-start.md) - 适合新手，快速上手

### 📖 详细指南
- [**完整配置指南**](./wecom-setup-guide.md) - 详细的配置步骤和注意事项
- [**实现总结**](./wecom-implementation-summary.md) - 技术架构和设计思路
- [**实现清单**](./wecom-implementation-checklist.md) - 所有修改文件的清单

### 🧪 测试
- [**自动化测试脚本**](../../../scripts/test-wecom-adapter.ts) - 运行 `npm run test:wecom-adapter`

## 🎯 我应该看哪个文档？

| 你的需求 | 推荐文档 |
|---------|---------|
| 第一次使用，想快速体验 | [快速开始](./wecom-quick-start.md) |
| 需要详细配置说明 | [配置指南](./wecom-setup-guide.md) |
| 想了解技术实现细节 | [实现总结](./wecom-implementation-summary.md) |
| 想查看所有修改的文件 | [实现清单](./wecom-implementation-checklist.md) |
| 想运行测试验证功能 | [测试脚本](../../../scripts/test-wecom-adapter.ts) |

## 📋 核心文件

### 适配器实现
- **路径**: `adapters/wecom-bot.adapter.ts`
- **功能**: 企业微信机器人适配器核心实现
- **技术**: 使用 OneBots 底层 WeComBot 类

### 模块注册
- **路径**: `bot-gateway.module.ts`
- **功能**: 注册 WeComBotAdapter 到 NestJS 依赖注入系统

### 工厂注册
- **路径**: `services/bot-adapter.factory.ts`
- **功能**: 在工厂中注册 'wecom' 平台类型

### 接口定义
- **路径**: `interfaces/bot-platform.interface.ts`
- **功能**: 定义 BotConfig 接口，添加 'wecom' 平台支持

### 平台元数据
- **路径**: `constants/platform-metadata.ts`
- **功能**: 配置企业微信平台的表单字段和显示信息

## 🔧 快速命令

```bash
# 安装依赖
npm install @onebots/adapter-wecom

# 编译项目
npm run build

# 启动开发服务器
npm run start:dev

# 运行测试
npm run test:wecom-adapter
```

## 🌟 主要特性

- ✅ 自动管理 Access Token
- ✅ 发送文本消息到指定用户
- ✅ 断线重连机制
- ✅ 完整的错误处理
- ✅ 详细的日志记录
- ✅ 与其他平台一致的架构

## ⚠️ 注意事项

1. **消息接收**: 当前基础版本主要演示消息发送功能，完整的消息接收需要配置 Webhook 或使用智能助手 WebSocket
2. **会话 ID**: 在企业微信中，`conversationId` 对应的是用户的 UserID
3. **可见范围**: 确保目标用户在应用的可见范围内

## 📞 技术支持

- 查看后端日志（搜索 "WeComBotAdapter"）
- [企业微信开放平台文档](https://developer.work.weixin.qq.com/document/path/90236)
- [OneBots 官方文档](https://github.com/lc-cn/onebots)

## 📅 更新历史

- **2026-04-28**: 初始实现完成
  - 创建 WeComBotAdapter
  - 注册到模块和工厂
  - 编写完整文档
  - 创建测试脚本
