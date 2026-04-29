/**
 * 全局智能右键菜单管理器
 * 
 * 功能：
 * - 上下文感知：根据点击目标显示不同的菜单选项
 * - 自动检测：通过事件系统自动识别已有自定义菜单的区域
 * - 兼容性好：不破坏现有组件的自定义右键菜单
 */

interface MenuItem {
  label: string
  type?: 'normal' | 'separator'
  action?: () => void
}

class ContextMenuManager {
  private static instance: ContextMenuManager
  private menuElement: HTMLDivElement | null = null

  static getInstance(): ContextMenuManager {
    if (!ContextMenuManager.instance) {
      ContextMenuManager.instance = new ContextMenuManager()
    }
    return ContextMenuManager.instance
  }

  /**
   * 检查是否在 Electron 环境中
   */
  private isElectron(): boolean {
    return !!(window as any).electronAPI
  }

  /**
   * 初始化全局右键菜单监听
   */
  init(): void {
    // 仅在 Electron 环境下启用全局菜单
    if (!this.isElectron()) {
      console.log('[ContextMenu] 非 Electron 环境，使用浏览器默认菜单')
      return
    }

    // 第1步：捕获阶段监听器 - 确保我们的监听器最先执行
    document.addEventListener('contextmenu', (event: MouseEvent) => {
      console.log('[ContextMenu] 捕获阶段')
    }, true)

    // 第2步：冒泡阶段监听器 - 检查是否有子组件阻止了默认行为
    document.addEventListener('contextmenu', (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // 关键：在冒泡阶段检查 defaultPrevented
      // 如果子组件已经调用了 preventDefault()，说明有自定义菜单
      if (event.defaultPrevented) {
        console.log('[ContextMenu] 检测到自定义菜单，跳过全局菜单')
        return
      }

      // 如果没有子组件处理，显示全局智能菜单
      event.preventDefault()
      this.showGlobalMenu(event, target)
    }, false) // 冒泡阶段

    // 点击其他地方关闭菜单
    document.addEventListener('click', () => {
      this.hideMenu()
    })

    console.log('[ContextMenu] 全局右键菜单管理器已初始化（Electron 环境）')
  }

  /**
   * 显示全局智能菜单（使用原生 DOM 实现）
   */
  private showGlobalMenu(event: MouseEvent, target: HTMLElement): void {
    const menuItems = this.buildMenuItems(target)

    if (menuItems.length === 0) {
      return
    }

    // 隐藏旧菜单
    this.hideMenu()

    // 创建菜单容器
    const menu = document.createElement('div')
    menu.className = 'global-context-menu'
    menu.style.cssText = `
      position: fixed;
      left: ${event.clientX}px;
      top: ${event.clientY}px;
      background: white;
      border: 1px solid #e4e7ed;
      border-radius: 4px;
      box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
      padding: 4px 0;
      min-width: 160px;
      z-index: 9999;
    `

    // 添加菜单项
    menuItems.forEach(item => {
      if (item.type === 'separator') {
        const separator = document.createElement('div')
        separator.style.cssText = 'height: 1px; background: #e4e7ed; margin: 4px 0;'
        menu.appendChild(separator)
      } else {
        const menuItem = document.createElement('div')
        menuItem.className = 'context-menu-item'
        menuItem.textContent = item.label
        menuItem.style.cssText = `
          padding: 8px 16px;
          cursor: pointer;
          font-size: 14px;
          color: #606266;
          transition: background 0.2s;
        `
        
        menuItem.addEventListener('mouseenter', () => {
          menuItem.style.background = '#f5f7fa'
        })
        
        menuItem.addEventListener('mouseleave', () => {
          menuItem.style.background = ''
        })
        
        menuItem.addEventListener('click', () => {
          if (item.action) {
            try {
              item.action()
            } catch (error) {
              console.error('[ContextMenu] 动作执行异常:', error)
            }
          }
          this.hideMenu()
        })
        
        menu.appendChild(menuItem)
      }
    })

    document.body.appendChild(menu)
    this.menuElement = menu

    // 调整菜单位置，避免超出屏幕
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`
    }
  }

  /**
   * 隐藏菜单
   */
  private hideMenu(): void {
    if (this.menuElement) {
      this.menuElement.remove()
      this.menuElement = null
    }
  }

  /**
   * 安全读取剪贴板文本（优先使用 Electron 原生 API）
   */
  private readClipboardText(): string {
    if ((window as any).electronAPI?.clipboard?.readText) {
      try {
        return (window as any).electronAPI.clipboard.readText()
      } catch (error) {
        console.warn('[ContextMenu] Electron clipboard 失败，降级到 Web API:', error)
      }
    }
    
    // 降级到 Web API
    return ''
  }

  /**
   * 安全写入剪贴板文本（使用 IPC 方式，更可靠）
   */
  private async writeClipboardText(text: string): Promise<void> {
    if (!text || text.trim() === '') {
      console.warn('[ContextMenu] 警告：尝试写入空文本到剪贴板')
      return
    }

    const win = window as any
    
    // 优先使用 IPC 方式（更可靠）
    if (win.electronAPI?.clipboardIPC?.writeText) {
      try {
        const result = await win.electronAPI.clipboardIPC.writeText(text)
        
        if (!result.success) {
          console.error('[ContextMenu] IPC 写入失败:', result.error)
          this.fallbackWriteToClipboard(text)
        }
      } catch (error) {
        console.error('[ContextMenu] IPC 调用异常:', error)
        this.fallbackWriteToClipboard(text)
      }
    } else if (win.electronAPI?.clipboard?.writeText) {
      this.fallbackWriteToClipboard(text)
    } else {
      console.error('[ContextMenu] 所有剪贴板 API 都不可用')
    }
  }

  /**
   * 回退方案：直接调用 preload 暴露的 clipboard API
   */
  private fallbackWriteToClipboard(text: string): void {
    const win = window as any
    
    if (win.electronAPI?.clipboard?.writeText) {
      try {
        win.electronAPI.clipboard.writeText(text)
      } catch (error) {
        console.error('[ContextMenu] 直接调用失败:', error)
        this.webAPIFallback(text)
      }
    } else {
      this.webAPIFallback(text)
    }
  }

  /**
   * 最后的回退：使用 Web Clipboard API
   */
  private webAPIFallback(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(error => {
        console.error('[ContextMenu] Web API 写入失败:', error)
      })
    } else {
      console.error('[ContextMenu] Web Clipboard API 不可用')
    }
  }

  /**
   * 根据上下文构建菜单项
   */
  private buildMenuItems(target: HTMLElement): MenuItem[] {
    const items: MenuItem[] = []

    // 场景1：选中文本
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim()
    
    if (selectedText) {
      items.push({ 
        label: '复制', 
        action: () => {
          this.writeClipboardText(selectedText)
        }
      })
    }

    // 场景2：输入框编辑
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
    const isContentEditable = target.isContentEditable

    if (isInput || isContentEditable) {
      const inputElement = target as HTMLInputElement | HTMLTextAreaElement
      const hasSelection = inputElement.selectionStart !== inputElement.selectionEnd

      // 粘贴
      items.push({ 
        label: '粘贴', 
        action: () => {
          const text = this.readClipboardText()
          if (!text) return
          
          if (isContentEditable) {
            document.execCommand('insertText', false, text)
          } else {
            const start = inputElement.selectionStart || 0
            const end = inputElement.selectionEnd || 0
            const value = inputElement.value
            inputElement.value = value.substring(0, start) + text + value.substring(end)
            inputElement.setSelectionRange(start + text.length, start + text.length)
          }
        }
      })

      // 剪切（仅当有选中内容时）
      if (hasSelection) {
        items.push({ 
          label: '剪切', 
          action: () => {
            const start = inputElement.selectionStart || 0
            const end = inputElement.selectionEnd || 0
            const selectedText = inputElement.value.substring(start, end)
            this.writeClipboardText(selectedText)
            inputElement.value = inputElement.value.substring(0, start) + inputElement.value.substring(end)
            inputElement.setSelectionRange(start, start)
          }
        })
      }

      // 复制（仅当有选中内容时）
      if (hasSelection) {
        items.push({ 
          label: '复制', 
          action: () => {
            const start = inputElement.selectionStart || 0
            const end = inputElement.selectionEnd || 0
            const selectedText = inputElement.value.substring(start, end)
            this.writeClipboardText(selectedText)
          }
        })
      }

      // 全选
      items.push({ 
        label: '全选', 
        action: () => inputElement.select()
      })
    }

    // 场景3：链接
    const link = target.closest('a')
    if (link && link.href) {
      items.push({ 
        label: '在新窗口打开', 
        action: () => window.open(link.href, '_blank')
      })
      items.push({ 
        label: '复制链接地址', 
        action: () => this.writeClipboardText(link.href)
      })
    }

    // 场景4：图片
    const img = target.closest('img')
    if (img && img.src) {
      items.push({ 
        label: '保存图片', 
        action: () => {
          const a = document.createElement('a')
          a.href = img.src
          a.download = img.alt || 'image.png'
          a.click()
        }
      })
    }

    // 场景5：默认选项
    if (items.length === 0) {
      items.push({ 
        label: '刷新', 
        action: () => location.reload()
      })
    }

    return items
  }
}

export default ContextMenuManager
