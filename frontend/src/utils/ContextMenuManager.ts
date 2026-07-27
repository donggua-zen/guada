/**
 * 全局智能右键菜单管理器
 *
 * 功能：
 * - 上下文感知：根据点击目标显示不同的菜单选项
 * - 自动检测：通过事件系统自动识别已有自定义菜单的区域
 * - 兼容性好：不破坏现有组件的自定义右键菜单
 *
 * 编辑器解耦设计：
 * 组件通过 DOM 属性注册 EditorHandler 实现，ContextMenuManager 仅调用接口方法，
 * 不依赖任何编辑器实现（Tiptap/Quill 等）。
 */

import { openExternalLink } from "./modelUtils";

export interface MenuItem {
  label: string;
  type?: "normal" | "separator";
  action?: () => void;
}

/**
 * 编辑器处理器接口 —— 组件实现此接口并挂载到 DOM 元素上，
 * ContextMenuManager 通过 data-editor-handler 属性查找并调用。
 * 这样 ContextMenuManager 不直接依赖任何编辑器实现。
 */
export interface EditorHandler {
  /** 获取选中文本 */
  getSelectionText(): string;
  /** 粘贴文本到光标位置（含滚动到可视区域） */
  paste(text: string): void;
  /** 删除选中内容 */
  deleteSelection(): void;
  /** 全选 */
  selectAll(): void;
}

type ShowMenuFn = (x: number, y: number, items: MenuItem[]) => void;

class ContextMenuManager {
  private static instance: ContextMenuManager;
  private showMenuFn: ShowMenuFn | null = null;

  setShowMenuFn(fn: ShowMenuFn) {
    this.showMenuFn = fn;
  }

  static getInstance(): ContextMenuManager {
    if (!ContextMenuManager.instance) {
      ContextMenuManager.instance = new ContextMenuManager();
    }
    return ContextMenuManager.instance;
  }

  /**
   * 检查是否在 Electron 环境中
   */
  private isElectron(): boolean {
    return !!window.electronAPI;
  }

  /**
   * 初始化全局右键菜单监听
   */
  init(): void {
    // 仅在 Electron 环境下启用全局菜单
    if (!this.isElectron()) {
      console.log("[ContextMenu] 非 Electron 环境，使用浏览器默认菜单");
      return;
    }

    // 第1步：捕获阶段监听器 - 确保我们的监听器最先执行
    document.addEventListener(
      "contextmenu",
      (event: MouseEvent) => {
        console.log("[ContextMenu] 捕获阶段");
      },
      true,
    );

    // 第2步：冒泡阶段监听器 - 检查是否有子组件阻止了默认行为
    document.addEventListener(
      "contextmenu",
      (event: MouseEvent) => {
        const target = event.target as HTMLElement;

        // 关键：在冒泡阶段检查 defaultPrevented
        // 如果子组件已经调用了 preventDefault()，说明有自定义菜单
        if (event.defaultPrevented) {
          console.log("[ContextMenu] 检测到自定义菜单，跳过全局菜单");
          return;
        }

        // 排除标题栏区域（CustomTitlebar 组件）
        if (target.closest(".custom-titlebar")) {
          console.log("[ContextMenu] 检测到标题栏区域，跳过全局菜单");
          return;
        }

        // 如果没有子组件处理，显示全局智能菜单
        event.preventDefault();
        this.showGlobalMenu(event, target);
      },
      false,
    ); // 冒泡阶段

    // 点击其他地方关闭菜单
    document.addEventListener("click", () => {
      this.hideMenu();
    });

    console.log("[ContextMenu] 全局右键菜单管理器已初始化（Electron 环境）");
  }

  /**
   * 显示全局智能菜单（使用原生 DOM 实现）
   */
  private showGlobalMenu(event: MouseEvent, target: HTMLElement): void {
    const menuItems = this.buildMenuItems(target);
    if (menuItems.length === 0 || !this.showMenuFn) return;
    this.showMenuFn(event.clientX, event.clientY, menuItems);
  }

  /**
   * 隐藏菜单
   */
  private hideMenu(): void {
    // 菜单关闭由 ContextMenu 组件管理
  }

  /**
   * 安全读取剪贴板文本（优先使用 IPC 异步 API）
   */
  private async readClipboardText(): Promise<string> {
    const electronAPI = window.electronAPI;

    // 优先使用 IPC 方式（更可靠）
    if (electronAPI?.clipboardIPC?.readText) {
      try {
        const result = await electronAPI.clipboardIPC.readText();
        if (result.success) {
          return result.text || "";
        }
        console.warn("[ContextMenu] IPC 读取失败:", result.error);
      } catch (error) {
        console.warn("[ContextMenu] IPC 调用异常:", error);
      }
    }

    // 回退：直接调用 preload 暴露的同步 API
    if (electronAPI?.clipboard?.readText) {
      try {
        const text = electronAPI.clipboard.readText();
        if (text) return text;
      } catch (error) {
        console.warn("[ContextMenu] 同步 clipboard 调用失败:", error);
      }
    }

    // 最后回退到 Web Clipboard API
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch (error) {
        console.warn("[ContextMenu] Web API 读取失败:", error);
      }
    }

    return "";
  }

  /**
   * 安全写入剪贴板文本（使用 IPC 方式，更可靠）
   */
  private async writeClipboardText(text: string): Promise<void> {
    if (!text || text.trim() === "") {
      console.warn("[ContextMenu] 警告：尝试写入空文本到剪贴板");
      return;
    }

    const electronAPI = window.electronAPI;

    // 优先使用 IPC 方式（更可靠）
    if (electronAPI?.clipboardIPC?.writeText) {
      try {
        const result = await electronAPI.clipboardIPC.writeText(text);

        if (!result.success) {
          console.error("[ContextMenu] IPC 写入失败:", result.error);
          this.fallbackWriteToClipboard(text);
        }
      } catch (error) {
        console.error("[ContextMenu] IPC 调用异常:", error);
        this.fallbackWriteToClipboard(text);
      }
    } else if (electronAPI?.clipboard?.writeText) {
      this.fallbackWriteToClipboard(text);
    } else {
      console.error("[ContextMenu] 所有剪贴板 API 都不可用");
    }
  }

  /**
   * 回退方案：直接调用 preload 暴露的 clipboard API
   */
  private fallbackWriteToClipboard(text: string): void {
    const electronAPI = window.electronAPI;

    if (electronAPI?.clipboard?.writeText) {
      try {
        electronAPI.clipboard.writeText(text);
      } catch (error) {
        console.error("[ContextMenu] 直接调用失败:", error);
        this.webAPIFallback(text);
      }
    } else {
      this.webAPIFallback(text);
    }
  }

  /**
   * 最后的回退：使用 Web Clipboard API
   */
  private webAPIFallback(text: string): void {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch((error) => {
        console.error("[ContextMenu] Web API 写入失败:", error);
      });
    } else {
      console.error("[ContextMenu] Web Clipboard API 不可用");
    }
  }
  /**
   * 在 contenteditable 元素的光标位置插入纯文本
   * @param {string} text 要插入的文本
   * @returns {boolean} 是否插入成功
   */

  /**
   * 查找目标元素关联的编辑器处理器
   * 组件需在 DOM 元素上设置 data-editor-handler 属性和 __editorHandler 对象
   */
  private getEditorHandler(target: HTMLElement): EditorHandler | null {
    const el = target.closest("[data-editor-handler]") as (HTMLElement & { __editorHandler?: EditorHandler }) | null;
    return el?.__editorHandler || null;
  }

  /**
   * 获取 contenteditable 元素的选中文本
   */
  private getContentEditableSelection(target: HTMLElement): {
    text: string;
    range: Range | null;
  } {
    // 优先使用注册的编辑器处理器
    const handler = this.getEditorHandler(target);
    if (handler) {
      return { text: handler.getSelectionText(), range: null };
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      return { text: range.toString(), range };
    }
    return { text: "", range: null };
  }

  /**
   * 删除 contenteditable 元素的选中文本
   */
  private deleteContentEditableSelection(target: HTMLElement): void {
    const handler = this.getEditorHandler(target);
    if (handler) {
      handler.deleteSelection();
      return;
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
    }
  }

  /**
   * 全选 contenteditable 元素内容
   */
  private selectAllContentEditable(target: HTMLElement): void {
    const handler = this.getEditorHandler(target);
    if (handler) {
      handler.selectAll();
      return;
    }

    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(target);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  /**
   * 粘贴文本到 contenteditable 元素
   */
  private insertTextToContentEditable(
    text: string,
    target: HTMLElement,
  ): boolean {
    const handler = this.getEditorHandler(target);
    if (handler) {
      handler.paste(text);
      return true;
    }

    // 回退：使用 Selection API 插入文本
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;

    const range = sel.getRangeAt(0);
    range.deleteContents(); // 删除选中的内容
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);

    // 光标移到插入文本的末尾
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  /**
   * 根据上下文构建菜单项
   */
  private buildMenuItems(target: HTMLElement): MenuItem[] {
    const items: MenuItem[] = [];

    // 场景1：非输入框区域的选中文本复制
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (selectedText && !target.isContentEditable) {
      items.push({
        label: "复制",
        action: () => {
          this.writeClipboardText(selectedText);
        },
      });
    }

    // 场景2：输入框编辑
    const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
    const isContentEditable = target.isContentEditable;

    if (isInput || isContentEditable) {
      let hasSelection: boolean;
      let selectedText: string;

      if (isContentEditable) {
        const selInfo = this.getContentEditableSelection(target);
        selectedText = selInfo.text;
        hasSelection = selectedText.length > 0;
      } else {
        const inputElement = target as HTMLInputElement | HTMLTextAreaElement;
        hasSelection =
          inputElement.selectionStart !== inputElement.selectionEnd;
        selectedText = inputElement.value.substring(
          inputElement.selectionStart || 0,
          inputElement.selectionEnd || 0,
        );
      }

      // 复制（仅当有选中内容时）
      if (hasSelection) {
        items.push({
          label: "复制",
          action: () => {
            this.writeClipboardText(selectedText);
          },
        });
      }

      // 粘贴
      items.push({
        label: "粘贴",
        action: async () => {
          const text = await this.readClipboardText();
          if (!text) return;
          if (isContentEditable) {
            this.insertTextToContentEditable(text, target);
          } else {
            const inputElement = target as
              | HTMLInputElement
              | HTMLTextAreaElement;
            const start = inputElement.selectionStart || 0;
            const end = inputElement.selectionEnd || 0;
            const value = inputElement.value;
            inputElement.value =
              value.substring(0, start) + text + value.substring(end);
            inputElement.setSelectionRange(
              start + text.length,
              start + text.length,
            );
            // 触发 input 事件，确保 Vue v-model 同步
            inputElement.dispatchEvent(new Event("input", { bubbles: true }));
          }
        },
      });

      // 剪切（仅当有选中内容时）
      if (hasSelection) {
        items.push({
          label: "剪切",
          action: () => {
            this.writeClipboardText(selectedText);
            if (isContentEditable) {
              this.deleteContentEditableSelection(target);
            } else {
              const inputElement = target as
                | HTMLInputElement
                | HTMLTextAreaElement;
              const start = inputElement.selectionStart || 0;
              const end = inputElement.selectionEnd || 0;
              inputElement.value =
                inputElement.value.substring(0, start) +
                inputElement.value.substring(end);
              inputElement.setSelectionRange(start, start);
            }
          },
        });
      }

      // 全选
      items.push({
        label: "全选",
        action: () => {
          if (isContentEditable) {
            this.selectAllContentEditable(target);
          } else {
            (target as HTMLInputElement | HTMLTextAreaElement).select();
          }
        },
      });
    }

    // 场景3：链接
    const link = target.closest("a");
    if (link && link.href) {
      items.push({
        label: "在新窗口打开",
        action: () => openExternalLink(link.href),
      });
      items.push({
        label: "复制链接地址",
        action: () => this.writeClipboardText(link.href),
      });
    }

    // 场景4：图片
    const img = target.closest("img");
    if (img && img.src) {
      items.push({
        label: "保存图片",
        action: () => {
          const a = document.createElement("a");
          a.href = img.src;
          a.download = img.alt || "image.png";
          a.click();
        },
      });
    }

    // 场景5：默认选项
    if (items.length === 0) {
      items.push({
        label: "刷新",
        action: () => location.reload(),
      });
    }

    return items;
  }
}

export default ContextMenuManager;
