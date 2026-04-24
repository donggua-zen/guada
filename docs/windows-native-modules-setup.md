# Windows 原生模块编译环境设置

## 问题说明

在 Windows 上编译 Electron 应用的原生模块（如 `better-sqlite3`、`sqlite-vec`）时，需要 Visual Studio 的 C++ 编译工具链。

## 前置要求

### 1. 安装 Visual Studio

确保安装了 **Visual Studio 2019/2022/2026**（任意版本），并包含以下工作负载：
- ✅ **Desktop development with C++**（桌面 C++ 开发）

### 2. 安装 VSSetup PowerShell 模块

VSSetup 模块用于自动检测 Visual Studio 安装路径。

**以管理员身份运行 PowerShell**，然后执行：

```powershell
Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force
Install-Module VSSetup -Scope CurrentUser -Force
```

**或者普通用户权限**（推荐）：

```powershell
Install-Module VSSetup -Scope CurrentUser -Force
```

### 3. 验证安装

运行以下命令检查是否能检测到 Visual Studio：

```powershell
powershell -ExecutionPolicy Bypass -File check-vs.ps1
```

应该看到类似输出：

```
========================================
Visual Studio: Visual Studio Community 2026
Version: 18.4.11702.344
Path: D:\Program Files\Microsoft Visual Studio\18\Community

Required packages:
  - Microsoft.VisualStudio.Component.VC.Tools.x86.x64
  - Microsoft.VisualStudio.Component.Windows11SDK.22621
```

## 构建流程

### 自动重建原生模块

项目已配置自动化脚本，会在构建 Electron 应用前自动重新编译原生模块：

```bash
npm run build:electron
```

该命令会依次执行：
1. 编译 TypeScript 代码
2. 构建后端
3. **重新编译原生模块**（针对 Electron 版本）
4. 构建前端
5. 打包 Electron 应用

### 手动重建原生模块

如果需要单独重新编译原生模块：

```bash
npm run rebuild:backend-native
```

## 故障排查

### 错误：Could not find any Visual Studio installation to use

**原因**：node-gyp 无法找到 Visual Studio

**解决方案**：
1. 确认已安装 VSSetup 模块：`Get-Module -ListAvailable VSSetup`
2. 如果没有安装，运行：`Install-Module VSSetup -Scope CurrentUser`
3. 确认 Visual Studio 安装了 "Desktop development with C++" 工作负载

### 错误：NODE_MODULE_VERSION 不匹配

**原因**：原生模块是为 Node.js 编译的，而不是 Electron

**解决方案**：
运行 `npm run rebuild:backend-native` 重新编译

### 错误：vcvarsall.bat not found

**原因**：Visual Studio 安装不完整或路径错误

**解决方案**：
1. 打开 Visual Studio Installer
2. 修改安装，确保勾选 "Desktop development with C++"
3. 重新运行构建

## 技术细节

### 为什么需要重新编译？

Electron 使用自己的 Node.js 版本，与系统安装的 Node.js 版本不同。原生模块（`.node` 文件）必须针对特定的 Node.js ABI 版本编译。

例如：
- Node.js 25: NODE_MODULE_VERSION = 141
- Electron 41 (Node.js 24): NODE_MODULE_VERSION = 145

### 自动检测机制

`scripts/rebuild-native.js` 脚本会：
1. 使用 PowerShell + VSSetup 模块自动检测 Visual Studio 安装路径
2. 调用 `vcvarsall.bat` 设置编译环境变量
3. 使用正确的 Electron 版本配置重新编译原生模块

这种方法**不需要硬编码路径**，可以适配任何用户的 Visual Studio 安装位置。
