# AI Chat Web Application

AI Chat 是一个现代化的聊天应用前端界面，基于 Vue 3 和 Vite 构建，专为与 AI 模型交互而设计。它提供了丰富的功能，包括会话管理、角色设定、模型配置等。

![Vue.js](https://img.shields.io/badge/Vue.js-3.x-4FC08D?style=flat&logo=vue.js&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7.x-646CFF?style=flat&logo=vite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

## 功能特点

- 💬 实时 AI 聊天体验
- 📝 多会话管理
- 👤 角色设定与个性化
- ⚙️ 模型配置与提供商管理
- 🔐 用户认证与安全设置
- 🎨 响应式设计，支持多种设备
- 📁 文件上传与预览
- 💅 使用 Tailwind CSS 和 Naive UI 构建的现代化界面

## 技术栈

- [Vue 3](https://vuejs.org/) (Composition API with `<script setup>`)
- [Vite](https://vitejs.dev/) 构建工具
- [Pinia](https://pinia.vuejs.org/) 状态管理
- [Vue Router](https://router.vuejs.org/) 路由管理
- [Tailwind CSS](https://tailwindcss.com/) 样式框架
- [Naive UI](https://www.naiveui.com/) 组件库
- [Axios](https://axios-http.com/) HTTP 客户端
- [Marked](https://marked.js.org/) & [Highlight.js](https://highlightjs.org/) Markdown 渲染和代码高亮

## 快速开始

### 环境要求

- Node.js >= 16
- npm/yarn/pnpm

### 安装

```bash
# 克隆项目
git clone <repository-url>

# 进入项目目录
cd frontend

# 安装依赖
npm install
# 或者使用 yarn
# yarn install
# 或者使用 pnpm
# pnpm install
```

### 开发

```bash
# 启动开发服务器
npm run dev
# 或者
# vite

# 默认访问地址: http://localhost:3000
```

### 构建

```bash
# 构建生产版本
npm run build
# 或者
# vite build

# 构建后的文件位于 dist/ 目录
```

### 预览

```bash
# 预览生产构建
npm run preview
# 或者
# vite preview
```

## 项目结构

```
src/
├── components/        # Vue 组件
│   ├── icons/         # 图标组件
│   ├── settings/      # 设置相关组件
│   ├── ui/            # UI 组件
│   └── ...            # 其他功能组件
├── composables/       # Vue 组合式函数
├── services/          # API 服务
├── stores/            # Pinia 状态存储
├── utils/             # 工具函数
├── App.vue            # 根组件
├── main.js            # 应用入口
└── style.css          # 全局样式
```

## 主要组件

- **ChatPage**: 聊天主界面
- **ChatPanel**: 聊天面板组件
- **MessageItem**: 消息项组件
- **Sidebar**: 侧边栏组件
- **SettingsModal**: 设置模态框
- **CharacterModal**: 角色设定模态框
- **LoginPage**: 登录页面

## 浏览器支持

- Chrome >= 80
- Firefox >= 70
- Safari >= 13
- Edge >= 80

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 贡献

欢迎提交 Issue 和 Pull Request 来帮助改进项目。

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request