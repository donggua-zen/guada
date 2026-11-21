import { defineComponent, h, markRaw, type Component } from "vue";

type Shape = readonly [tag: "path" | "rect" | "circle", attrs: Record<string, string | number>];

/** 工具动作图标：16px 原生网格、1.25px 圆角线框；颜色跟随宿主状态。 */
function createToolIcon(name: string, shapes: readonly Shape[]): Component {
  return markRaw(defineComponent({
    name,
    setup() {
      return () => h("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        width: 16,
        height: 16,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.25,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
        focusable: "false",
      }, shapes.map(([tag, attrs]) => h(tag, attrs)));
    },
  }));
}

export const ToolGenericIcon = createToolIcon("ToolGenericIcon", [
  ["path", { d: "M6.5 1.75 7.85 5.6 11.75 7 7.85 8.4 6.5 12.25 5.1 8.4 1.25 7 5.1 5.6 6.5 1.75Z" }],
  ["path", { d: "m12.25 9.5.7 1.95 1.8.8-1.8.75-.7 1.75-.75-1.75-1.75-.75 1.75-.8.75-1.95Z" }],
]);

export const ToolReadIcon = createToolIcon("ToolReadIcon", [
  ["path", { d: "M9.5 1.75H4A1.25 1.25 0 0 0 2.75 3v10A1.25 1.25 0 0 0 4 14.25h8A1.25 1.25 0 0 0 13.25 13V5.5L9.5 1.75Z" }],
  ["path", { d: "M9.25 1.75v4h4M5.25 7.75h5.5M5.25 10h5.5M5.25 12.25h2.5" }],
]);

export const ToolWriteIcon = createToolIcon("ToolWriteIcon", [
  ["path", { d: "M8.25 14.25H4A1.25 1.25 0 0 1 2.75 13V3A1.25 1.25 0 0 1 4 1.75h5.5l3.75 3.75v2.75" }],
  ["path", { d: "M9.25 1.75v4h4M5.25 8h2.5M11.75 9.75v4.5M9.5 12h4.5" }],
]);

export const ToolEditIcon = createToolIcon("ToolEditIcon", [
  ["path", { d: "m3 10.5 7.75-7.75a1.77 1.77 0 0 1 2.5 2.5L5.5 13 2 14l1-3.5Z" }],
  ["path", { d: "m9.25 4.25 2.5 2.5M8.5 14h5.25" }],
]);

export const ToolSearchIcon = createToolIcon("ToolSearchIcon", [
  ["circle", { cx: 6.75, cy: 6.75, r: 4.5 }],
  ["path", { d: "m10 10 3.75 3.75" }],
]);

export const ToolTerminalIcon = createToolIcon("ToolTerminalIcon", [
  ["rect", { x: 1.75, y: 2.75, width: 12.5, height: 10.5, rx: 1.5 }],
  ["path", { d: "m4.5 5.75 2.25 2.25-2.25 2.25M8.75 10.25h2.5" }],
]);

export const ToolBrowserIcon = createToolIcon("ToolBrowserIcon", [
  ["rect", { x: 1.75, y: 2.25, width: 12.5, height: 11.5, rx: 1.5 }],
  ["path", { d: "M1.75 5.25h12.5M4.25 3.75h.01M6.25 3.75h.01m1.25 3.5 4.5 3-2.25.5-1 2.25-1.25-5.75Z" }],
]);

export const ToolComputerIcon = createToolIcon("ToolComputerIcon", [
  ["rect", { x: 1.75, y: 2.25, width: 12.5, height: 9, rx: 1.25 }],
  ["path", { d: "M4.75 14h6.5M6.25 11.25V14M9.75 11.25V14" }],
  ["path", { d: "m6.25 4.25 3.5 2.5-1.7.35-.75 1.55-1.05-4.4Z" }],
]);

export const ToolVisionIcon = createToolIcon("ToolVisionIcon", [
  ["path", { d: "M1.5 8S4 3.75 8 3.75 14.5 8 14.5 8 12 12.25 8 12.25 1.5 8 1.5 8Z" }],
  ["circle", { cx: 8, cy: 8, r: 2.25 }],
]);

export const ToolTodoIcon = createToolIcon("ToolTodoIcon", [
  ["rect", { x: 1.75, y: 1.75, width: 12.5, height: 12.5, rx: 1.5 }],
  ["path", { d: "m4 5.25 1 1 1.75-2M9 5.5h3M4.25 10.5h1.5M9 10.5h3" }],
]);

export const ToolBookIcon = createToolIcon("ToolBookIcon", [
  ["path", {
    d: "M7.15.2h1.7a1.25 1.25 0 0 1 1.25 1.25v13.1a1.25 1.25 0 0 1-1.25 1.25h-1.7a1.25 1.25 0 0 1-1.25-1.25V1.45A1.25 1.25 0 0 1 7.15.2ZM7.25 1.2h1.5a.35.35 0 0 1 .35.35v6.4H6.9v-6.4a.35.35 0 0 1 .35-.35Z",
    transform: "rotate(45 8 8)", fill: "currentColor", "fill-rule": "evenodd", stroke: "none",
  }],
  ["path", {
    d: "M3 1.1Q3.4 2.6 4.9 3 3.4 3.4 3 4.9 2.6 3.4 1.1 3 2.6 2.6 3 1.1ZM13 11.1Q13.4 12.6 14.9 13 13.4 13.4 13 14.9 12.6 13.4 11.1 13 12.6 12.6 13 11.1Z",
    fill: "currentColor", stroke: "none",
  }],
]);

export const ToolTimeIcon = createToolIcon("ToolTimeIcon", [
  ["circle", { cx: 8, cy: 8, r: 6.25 }],
  ["path", { d: "M8 4v4l2.75 1.75" }],
]);

export const ToolChatIcon = createToolIcon("ToolChatIcon", [
  ["path", { d: "M5 12.25 2 14V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5Z" }],
  ["path", { d: "M5 6.25h6M5 9h4" }],
]);

export const ToolCodeIcon = createToolIcon("ToolCodeIcon", [
  ["path", { d: "m5 4-3.5 4L5 12M11 4l3.5 4-3.5 4M9.25 2.25l-2.5 11.5" }],
]);

export const ToolWindowIcon = createToolIcon("ToolWindowIcon", [
  ["rect", { x: 1.75, y: 2.25, width: 12.5, height: 11.5, rx: 1.5 }],
  ["path", { d: "M1.75 5.25h12.5M4.25 3.75h.01M6.25 3.75h.01" }],
]);
