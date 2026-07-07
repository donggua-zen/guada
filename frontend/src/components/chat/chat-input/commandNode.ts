import { Node, mergeAttributes } from '@tiptap/core';

/**
 * 自定义 Command 节点扩展
 * 用于在富文本编辑器中渲染命令徽标（斜杠 / 艾特 @）
 * 原始文本输出格式: [/type:name label="xxx"] 或 [@type:name label="xxx"]
 *
 * attrs:
 *   - providerId: 提供者 id，如 "skill"（对应标签中的 type）
 *   - name: 命令标识，如 "coder"（对应冒号后的值）
 *   - label: 友好展示名（可选），如 "编程助手"
 *   - trigger: 触发前缀，'/' 或 '@'（默认 '/'）
 */
export const CommandNode = Node.create({
  name: 'command',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      providerId: {
        default: 'skill',
        parseHTML: (element) => element.getAttribute('data-provider-id'),
        renderHTML: (attributes) => ({
          'data-provider-id': attributes.providerId,
        }),
      },
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-name'),
        renderHTML: (attributes) => ({
          'data-name': attributes.name,
        }),
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label'),
        renderHTML: (attributes) => ({
          'data-label': attributes.label,
        }),
      },
      trigger: {
        default: '/',
        parseHTML: (element) => element.getAttribute('data-trigger') || '/',
        renderHTML: (attributes) => ({
          'data-trigger': attributes.trigger || '/',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="command"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { label, name, trigger } = node.attrs;
    const displayText = label || `${trigger}${name}`;
    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'command',
          class: 'command-badge',
          contenteditable: 'false',
        },
        HTMLAttributes
      ),
      displayText,
    ];
  },

  renderText({ node }) {
    const { providerId, name, label, trigger } = node.attrs;
    const prefix = trigger === '@' ? '@' : '/';
    let text = `[${prefix}${providerId}:${name}`;
    if (label) {
      text += ` label="${label}"`;
    }
    text += ']';
    return text;
  },
});
