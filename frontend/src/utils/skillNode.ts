import { Node, mergeAttributes } from '@tiptap/core';

/**
 * 自定义 Skill 节点扩展
 * 用于在富文本编辑器中渲染技能徽标
 * 原始文本输出格式: <skill:skill-name>
 */
export const SkillNode = Node.create({
  name: 'skill',
  group: 'inline',
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-skill-name'),
        renderHTML: (attributes) => ({
          'data-skill-name': attributes.name,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="skill"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        {
          'data-type': 'skill',
          class: 'skill-badge',
          contenteditable: 'false',
        },
        HTMLAttributes
      ),
      `/${node.attrs.name}`,
    ];
  },

  renderText({ node }) {
    return `<skill:${node.attrs.name}>`;
  },

});
