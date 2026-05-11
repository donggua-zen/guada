/**
 * DOM 转 JSON 结构化工具 - 浏览器测试版本 (包含扁平化方案)
 * 
 * 使用方法：
 * 1. 打开任意网页
 * 2. 按 F12 打开开发者工具
 * 3. 复制本文件全部内容粘贴到控制台执行
 * 4. 调用 testDomToJson() 查看树形结构结果
 * 5. 调用 testFlatJson() 查看扁平化结构结果
 */

// ==================== 核心函数 ====================

let idCounter = 0;

/**
 * 生成唯一的内部引用 ID
 */
function generateRef() {
  return `n${idCounter++}`;
}

/**
 * DOM 转 JSON 的核心函数（树形结构 - 方案 A）
 */
function domToJsonTree(element, depth) {
  if (depth > 50) return null;
  
  const node = { tag: element.tagName.toLowerCase() };
  
  // 提取属性
  const allowedAttrs = ['class', 'id', 'role', 'href'];
  const attrs = {};
  
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (allowedAttrs.includes(attr.name) || 
        (attr.name.startsWith('data-') && !attr.name.startsWith('data-v-'))) {
      attrs[attr.name] = attr.value;
    }
  }
  if (Object.keys(attrs).length > 0) Object.assign(node, attrs);
  
  // 文本内容
  const text = element.textContent ? element.textContent.trim() : '';
  if (element.children.length === 0 && text.length > 0) {
    node.text = text.substring(0, 10000);
  }
  
  // 递归子元素
  const children = [];
  for (let i = 0; i < element.children.length; i++) {
    const childNode = domToJsonTree(element.children[i], depth + 1);
    if (childNode) children.push(childNode);
  }
  if (children.length > 0) node.children = children;
  
  return node;
}

/**
 * DOM 转 JSON 的核心函数（扁平化结构 - 方案 C）
 * @returns {Array} 扁平化的节点数组
 */
function domToJsonFlat(element) {
  const nodes = [];
  const queue = [{ el: element, parentRef: null }];
  
  while (queue.length > 0) {
    const { el, parentRef } = queue.shift();
    const ref = generateRef();
    
    const node = {
      ref: ref,
      tag: el.tagName.toLowerCase()
    };
    
    if (parentRef) node.parent = parentRef;
    
    // 提取属性
    const allowedAttrs = ['class', 'id', 'role', 'href'];
    const attrs = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (allowedAttrs.includes(attr.name) || 
          (attr.name.startsWith('data-') && !attr.name.startsWith('data-v-'))) {
        // 如果是 id 属性，单独存放，不放入 attrs
        if (attr.name === 'id') {
          node.id = attr.value;
        } else {
          attrs[attr.name] = attr.value;
        }
      }
    }
    if (Object.keys(attrs).length > 0) Object.assign(node, attrs);
    
    // 文本内容
    const text = el.textContent ? el.textContent.trim() : '';
    if (el.children.length === 0 && text.length > 0) {
      node.text = text.substring(0, 10000);
    }
    
    // 处理子元素
    const childrenRefs = [];
    for (let i = 0; i < el.children.length; i++) {
      const childRef = generateRef(); // 预先生成 ref 以便建立关系
      // 注意：这里需要稍微调整逻辑，因为我们是 BFS/DFS 混合
      // 为了简单起见，我们在处理子节点时再分配 ref
    }
    
    // 重新调整为 DFS 以确保 children 顺序正确
    // 我们改用递归辅助函数来处理扁平化
  }
  
  // 重置计数器并使用递归辅助函数
  idCounter = 0;
  const flatList = [];
  
  function processNode(el, parentRef) {
    const ref = generateRef();
    const node = { ref, tag: el.tagName.toLowerCase() };
    
    if (parentRef) node.parent = parentRef;
    
    // 属性处理
    const attrs = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (attr.name === 'class' || attr.name === 'role' || attr.name === 'href') {
        attrs[attr.name] = attr.value;
      } else if (attr.name === 'id') {
        node.id = attr.value;
      } else if (attr.name.startsWith('data-') && !attr.name.startsWith('data-v-')) {
        const dataKey = attr.name.substring(5).toLowerCase();
        const allowedKeywords = ['url', 'id', 'link', 'href', 'src', 'path', 'route', 'target'];
        if (allowedKeywords.some(k => dataKey.includes(k))) {
          attrs[attr.name] = attr.value;
        }
      }
    }
    if (Object.keys(attrs).length > 0) Object.assign(node, attrs);
    
    // 文本
    const text = el.textContent ? el.textContent.trim() : '';
    if (el.children.length === 0 && text.length > 0) {
      node.text = text.substring(0, 10000);
    }
    
    // 子节点
    const children = [];
    for (let i = 0; i < el.children.length; i++) {
      const childRef = processNode(el.children[i], ref);
      children.push(childRef);
    }
    if (children.length > 0) node.children = children;
    
    flatList.push(node);
    return ref;
  }
  
  processNode(element, null);
  return flatList;
}

/**
 * 清理 DOM（移除不需要的元素）
 */
function cleanDom(root) {
  const clone = root.cloneNode(true);
  const unwantedSelectors = 'script, style, link, noscript, meta, iframe';
  const unwantedElements = clone.querySelectorAll(unwantedSelectors);
  for (let i = unwantedElements.length - 1; i >= 0; i--) {
    if (unwantedElements[i].parentNode) unwantedElements[i].parentNode.removeChild(unwantedElements[i]);
  }
  
  const svgs = clone.querySelectorAll('svg');
  for (let i = 0; i < svgs.length; i++) {
    while (svgs[i].attributes.length > 0) svgs[i].removeAttribute(svgs[i].attributes[0].name);
    while (svgs[i].firstChild) svgs[i].removeChild(svgs[i].firstChild);
  }
  
  function removeComments(node) {
    if (node.nodeType === Node.COMMENT_NODE) {
      if (node.parentNode) node.parentNode.removeChild(node);
      return;
    }
    Array.from(node.childNodes).forEach(removeComments);
  }
  removeComments(clone);
  
  function removeEmptyElements(node) {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        removeEmptyElements(child);
        const tagName = child.tagName.toLowerCase();
        if (['div', 'span', 'p', 'section', 'article', 'aside'].includes(tagName)) {
          const hasText = child.textContent && child.textContent.trim().length > 0;
          const hasChildren = child.children.length > 0;
          const hasImportantAttrs = child.hasAttribute('id') || child.hasAttribute('role') ||
                                   (child.className && typeof child.className === 'string' && 
                                    /nav|header|footer|main|content/.test(child.className));
          if (!hasText && !hasChildren && !hasImportantAttrs && child.parentNode) {
            child.parentNode.removeChild(child);
          }
        }
      }
    });
  }
  removeEmptyElements(clone);
  return clone;
}

// ==================== 测试函数 ====================

/**
 * 测试树形结构 (方案 A)
 */
function testDomToJson(useBody = false) {
  console.log('🌳 测试树形结构 (Scheme A)...');
  idCounter = 0;
  const root = useBody ? document.body : document.documentElement;
  const originalLength = root.outerHTML.length;
  const cleaned = cleanDom(root);
  const jsonStructure = domToJsonTree(cleaned, 0);
  const jsonLength = JSON.stringify(jsonStructure).length;
  
  console.log(`   原始大小: ${originalLength.toLocaleString()} chars`);
  console.log(`   JSON 大小: ${jsonLength.toLocaleString()} chars`);
  console.log(`   压缩率: ${((1 - jsonLength / originalLength) * 100).toFixed(2)}%\n`);
  return jsonStructure;
}

/**
 * 测试扁平化结构 (方案 C)
 */
function testFlatJson(useBody = false) {
  console.log('📋 测试扁平化结构 (Scheme C)...');
  idCounter = 0;
  const root = useBody ? document.body : document.documentElement;
  const originalLength = root.outerHTML.length;
  const cleaned = cleanDom(root);
  const flatList = domToJsonFlat(cleaned);
  const jsonLength = JSON.stringify(flatList).length;
  
  console.log(`   原始大小: ${originalLength.toLocaleString()} chars`);
  console.log(`   Flat JSON 大小: ${jsonLength.toLocaleString()} chars`);
  console.log(`   压缩率: ${((1 - jsonLength / originalLength) * 100).toFixed(2)}%`);
  console.log(`   节点总数: ${flatList.length}\n`);
  return flatList;
}

/**
 * DOM 转 JSON 的核心函数（极致压缩树形数组 - 方案 D）
 * 格式: [tag, attrs?, children?, text?]
 */
function domToJsonCompact(element, depth) {
  if (depth > 50) return null;
  
  const tag = element.tagName.toLowerCase();
  const result = [tag];
  
  // 1. 处理属性
  const allowedAttrs = ['class', 'id', 'role', 'href'];
  const attrs = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (allowedAttrs.includes(attr.name) || 
        (attr.name.startsWith('data-') && !attr.name.startsWith('data-v-'))) {
      attrs[attr.name] = attr.value;
    }
  }
  
  // 2. 处理文本
  const text = element.textContent ? element.textContent.trim() : '';
  const hasText = element.children.length === 0 && text.length > 0;
  
  // 3. 处理子节点
  const children = [];
  for (let i = 0; i < element.children.length; i++) {
    const childNode = domToJsonCompact(element.children[i], depth + 1);
    if (childNode) children.push(childNode);
  }
  
  // 按约定顺序填充数组，跳过空值以节省空间
  if (Object.keys(attrs).length > 0) {
    result.push(attrs);
  } else if (children.length > 0 || hasText) {
    result.push(null); // 占位，确保 children/text 在正确位置
  }
  
  if (children.length > 0) {
    if (result.length === 1) result.push(null); // 如果没有 attrs 但有 children
    result.push(children);
  } else if (hasText) {
    if (result.length === 1) result.push(null);
    result.push(null); // 占位 children
    result.push(text.substring(0, 10000));
  }
  
  return result;
}

/**
 * 测试极致压缩树形数组 (方案 D)
 */
function testCompactJson(useBody = false) {
  console.log('🗜️ 测试极致压缩树形数组 (Scheme D)...');
  idCounter = 0;
  const root = useBody ? document.body : document.documentElement;
  const originalLength = root.outerHTML.length;
  const cleaned = cleanDom(root);
  const compactStructure = domToJsonCompact(cleaned, 0);
  const jsonLength = JSON.stringify(compactStructure).length;
  
  console.log(`   原始大小: ${originalLength.toLocaleString()} chars`);
  console.log(`   Compact JSON 大小: ${jsonLength.toLocaleString()} chars`);
  console.log(`   压缩率: ${((1 - jsonLength / originalLength) * 100).toFixed(2)}%\n`);
  return compactStructure;
}

/**
 * DOM 转 JSON 的核心函数（选择器风格优化 - 方案 E - 语义化版）
 * 特点：使用 CSS 选择器风格合并 tag/class/id，长属性截断，键名语义化
 */
function domToSelectorStyle(element, depth) {
  if (depth > 50) return null;
  
  const tag = element.tagName.toLowerCase();
  const id = element.id;
  // 仅当 className 为字符串时处理，否则（如 SVG 对象）直接放弃
  const classes = (typeof element.className === 'string' && element.className) 
    ? element.className.trim().split(/\s+/).filter(Boolean) 
    : [];
  
  // 构建选择器字符串: tag.class1.class2#id
  let selectorStr = tag;
  if (classes.length > 0) selectorStr += '.' + classes.join('.');
  if (id) selectorStr += '#' + id;
  
  const node = { node: selectorStr };
  
  // 获取当前页面域名用于 URL 精简
  const currentHost = window.location.host;
  
  // 处理其他属性（排除 class, id, tag），并直接平铺到节点对象中
  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i];
    if (['class', 'id'].includes(attr.name)) continue;
    
    let value = attr.value;
    
    // 针对 href 进行同源域名精简
    if (attr.name === 'href' && value) {
      // 匹配 http://, https://, // 开头的域名
      const protocolRegex = /^(https?:)?\/\//;
      if (protocolRegex.test(value)) {
        // 提取 URL 中的 host
        try {
          const urlObj = new URL(value, window.location.href);
          if (urlObj.host === currentHost) {
            // 如果是同源，替换为以 / 开头的相对路径
            value = urlObj.pathname + urlObj.search + urlObj.hash;
            if (!value.startsWith('/')) value = '/' + value;
          }
        } catch (e) {
          // URL 解析失败则保持原样
        }
      }
    }
    
    // 白名单过滤与长度截断
    if (attr.name === 'href' || attr.name === 'role') {
      // 保留 href 和 role
    } else if (attr.name.startsWith('data-')) {
      // 严格过滤：必须以 data- 开头，且包含 -id 或 -url
      const suffix = attr.name.substring(5).toLowerCase();
      if (!suffix.includes('-id') && !suffix.includes('-url')) {
        continue; // 不符合要求则丢弃
      }
    } else {
      continue; // 其他属性直接丢弃
    }
    
    // 长度大于 300 截断
    if (value.length > 300) value = value.substring(0, 300) + '...';
    
    // 直接平铺属性到节点对象
    node[attr.name] = value;
  }
  
  // 处理文本
  const text = element.textContent ? element.textContent.trim() : '';
  if (element.children.length === 0 && text.length > 0) {
    node.text = text.substring(0, 10000);
  }
  
  // 处理子节点
  const children = [];
  for (let i = 0; i < element.children.length; i++) {
    const childNode = domToSelectorStyle(element.children[i], depth + 1);
    if (childNode) children.push(childNode);
  }
  
  if (children.length > 0) {
    // 检查是否所有子节点都只有 'node' 属性（即没有 attrs, text, children）
    const allSimple = children.every(c => Object.keys(c).length === 1 && c.node);
    
    if (allSimple) {
      // 如果都是简单节点，则转换为字符串数组
      node.children = children.map(c => c.node);
    } else {
      node.children = children;
    }
  }
  
  return node;
}

/**
 * 测试选择器风格优化 (方案 E)
 */
function testSelectorStyle(useBody = false) {
  console.log('🎯 测试选择器风格优化 (Scheme E)...');
  idCounter = 0;
  const root = useBody ? document.body : document.documentElement;
  const originalLength = root.outerHTML.length;
  const cleaned = cleanDom(root);
  const selectorStructure = domToSelectorStyle(cleaned, 0);
  const jsonLength = JSON.stringify(selectorStructure).length;
  
  console.log(`   原始大小: ${originalLength.toLocaleString()} chars`);
  console.log(`   Selector JSON 大小: ${jsonLength.toLocaleString()} chars`);
  console.log(`   压缩率: ${((1 - jsonLength / originalLength) * 100).toFixed(2)}%\n`);
  return selectorStructure;
}

/**
 * 打印对比结果 (包含方案 E)
 */
function compareSchemes() {
  console.log('⚖️ 全方案对比分析:\n');
  const tree = testDomToJson();
  const flat = testFlatJson();
  const compact = testCompactJson();
  const selector = testSelectorStyle();
  
  const treeSize = JSON.stringify(tree).length;
  const flatSize = JSON.stringify(flat).length;
  const compactSize = JSON.stringify(compact).length;
  const selectorSize = JSON.stringify(selector).length;
  
  console.log('🏆 最终结论:');
  console.log(`   1. 树形结构 (A):    ${treeSize.toLocaleString()} chars`);
  console.log(`   2. 扁平结构 (C):    ${flatSize.toLocaleString()} chars`);
  console.log(`   3. 极致压缩 (D):    ${compactSize.toLocaleString()} chars`);
  console.log(`   4. 选择器风格 (E):  ${selectorSize.toLocaleString()} chars`);
  
  const minSize = Math.min(treeSize, flatSize, compactSize, selectorSize);
  if (minSize === selectorSize) console.log('   👑 冠军: 选择器风格 (E)');
  else if (minSize === compactSize) console.log('   👑 冠军: 极致压缩数组法 (D)');
  else if (minSize === treeSize) console.log('   👑 冠军: 标准树形结构 (A)');
  else console.log('   👑 冠军: 扁平化结构 (C)');
  
  console.log('\n💡 提示: 使用 printSelectorSample() 查看选择器样例');
}

/**
 * 打印选择器样例
 */
function printSelectorSample() {
  const selector = testSelectorStyle();
  console.log('🔍 选择器风格样例 (前 2 层):');
  console.log(JSON.stringify(selector, null, 2));
}

console.log(`
✅ 增强版 DOM 转 JSON 工具已加载！

可用命令：
  compareSchemes()         - 对比四种方案的大小 (A/C/D/E)
  testDomToJson()          - 仅测试树形结构 (A)
  testFlatJson()           - 仅测试扁平化结构 (C)
  testCompactJson()        - 仅测试极致压缩数组 (D)
  testSelectorStyle()      - 仅测试选择器风格 (E)
  printSelectorSample()    - 查看选择器样例
`);
