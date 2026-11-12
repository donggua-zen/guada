/**
 * 桌宠窗口的 preload。
 *
 * 与主窗口的 preload 刻意分开：桌宠页是纯展示 + 少量交互的独立页面，
 * 不需要（也不应该）拿到主窗口那套浏览器自动化/文件系统能力。
 * 暴露面收窄到 7 个方法，全部围绕桌宠自身。
 */
import { contextBridge, ipcRenderer } from "electron";

interface PetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PetHitGeometry {
  image: PetRect;
  bubble: PetRect | null;
}

interface PetStatePayload {
  mode: "idle" | "walk" | "run" | "yawn";
  running: number;
  unread: number;
  title?: string;
  toolLabel?: string;
  sessionId?: string | null;
}

const petAPI = {
  /**
   * 素材配置（JSON 字符串 + 格式）。
   * file:// 下渲染层不能 fetch，统一由主进程读盘下发；
   * format 决定渲染层用逐帧播放器还是图集播放器。
   */
  onConfig: (
    callback: (
      configJson: string,
      format: "frames" | "atlas",
      baseUrl: string,
    ) => void,
  ) => {
    const listener = (
      _event: unknown,
      json: string,
      format: "frames" | "atlas",
      baseUrl: string,
    ) => callback(json, format, baseUrl);
    ipcRenderer.on("pet:config", listener);
    return () => ipcRenderer.removeListener("pet:config", listener);
  },

  /** 状态更新（模式/运行数/未读数/标题/工具名） */
  onState: (callback: (state: PetStatePayload) => void) => {
    const listener = (_event: unknown, state: PetStatePayload) => callback(state);
    ipcRenderer.on("pet:state", listener);
    return () => ipcRenderer.removeListener("pet:state", listener);
  },

  /** 透明度 + 宠物显示尺寸 + 播放倍速 */
  onSettings: (
    callback: (settings: {
      opacity: number;
      petPx?: number;
      animationSpeed?: number;
    }) => void,
  ) => {
    const listener = (
      _event: unknown,
      settings: { opacity: number; petPx?: number; animationSpeed?: number },
    ) => callback(settings);
    ipcRenderer.on("pet:settings", listener);
    return () => ipcRenderer.removeListener("pet:settings", listener);
  },

  /**
   * 窗口在屏幕上的可见区间（窗口内坐标）。
   * 贴边时窗口会有一部分在屏幕外，气泡据此横向偏移，避免被切掉。
   */
  onClip: (callback: (clip: { left: number; right: number }) => void) => {
    const listener = (_event: unknown, clip: { left: number; right: number }) =>
      callback(clip);
    ipcRenderer.on("pet:clip", listener);
    return () => ipcRenderer.removeListener("pet:clip", listener);
  },

  /** 首帧就绪：主进程据此补发配置/状态缓存 */
  ready: () => ipcRenderer.send("pet:ready"),

  /** 拖动（屏幕坐标增量） */
  dragMove: (delta: { dx: number; dy: number }) =>
    ipcRenderer.send("pet:drag-move", delta),

  /** 拖动结束：让主进程落盘位置并夹回可视区 */
  dragEnd: () => ipcRenderer.send("pet:drag-end"),

  /** 单击宠物：唤起主窗口（可带会话 id 直接跳转） */
  click: (payload: { sessionId?: string | null }) =>
    ipcRenderer.send("pet:click", payload),

  /** 气泡「停止」：中断指定会话的流 */
  stopSession: (payload: { sessionId?: string | null }) =>
    ipcRenderer.send("pet:stop-session", payload),

  /** 右键菜单 */
  contextMenu: (payload: { x: number; y: number }) =>
    ipcRenderer.send("pet:context-menu", payload),

  /**
   * 上报可交互几何（当前动画紧包围盒 + 气泡矩形），
   * 主进程据此决定鼠标穿透与否。
   */
  reportHitGeometry: (geometry: PetHitGeometry) =>
    ipcRenderer.send("pet:hit-geometry", geometry),
};

contextBridge.exposeInMainWorld("petAPI", petAPI);
