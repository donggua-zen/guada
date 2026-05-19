import { Component } from 'vue';
import Terminal from '@/components/icons/Terminal.vue';
import { Wrench24Filled, Edit32Filled, Search16Regular, BookSearch24Regular, BookOpen24Filled, Code24Regular, WindowWrench16Regular } from '@vicons/fluent';

/**
 * 根据 namespace 或 toolType 获取对应的工具图标
 * @param type 工具类型（可以是 namespace 或特殊 toolType）
 * @returns Vue 组件
 */
export function getToolIconByNamespace(type?: string): Component {
  if (!type) return Wrench24Filled;

  const iconMap: Record<string, Component> = {
    // Namespace 映射
    shell: Terminal,
    browser: WindowWrench16Regular,  // 浏览器默认图标

    // 特殊 toolType 映射（文件操作）
    edit: Edit32Filled,
    search: Search16Regular,
    code: Code24Regular,  // 代码执行

    // Namespace 特殊映射
    knowledge_base: BookSearch24Regular,
    read: BookOpen24Filled,
  };

  return iconMap[type] || Wrench24Filled;
}
