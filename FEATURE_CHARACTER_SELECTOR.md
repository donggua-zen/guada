# 新建会话页面 - 助手选择功能实现

## 📋 需求说明

在新建会话页面（`/chat/new-session`）实现助手选择功能：
1. ✅ 显示当前选中的助手
2. ✅ 点击打开带搜索的下拉框/弹窗
3. ✅ 支持搜索过滤助手列表
4. ✅ 选择的助手保存到本地存储
5. ✅ 下次访问时默认选中上次选择的助手
6. ✅ 第一次访问时使用列表中的第一个助手

---

## 🔧 实现方案

### 1. 数据结构

**本地存储键**: `lastSelectedCharacterId`  
**存储内容**: 用户上次选择的角色 ID

### 2. 组件修改

**文件**: `frontend/src/components/CreateSessionChatPanel.vue`

#### 新增响应式数据
```javascript
// 角色数据
const characters = ref([]);
const showCharacterSelector = ref(false);
const characterSearchText = ref('');

// 本地存储
const lastSelectedCharacterId = useStorage('lastSelectedCharacterId', '');
```

#### 新增计算属性
```javascript
// 当前选中的角色
const currentCharacter = computed(() => {
  if (currentSession.value.character_id) {
    return characters.value.find(c => c.id === currentSession.value.character_id);
  }
  return null;
});

// 过滤后的角色列表（支持搜索）
const filteredCharacters = computed(() => {
  if (!characterSearchText.value) {
    return characters.value;
  }
  const searchText = characterSearchText.value.toLowerCase();
  return characters.value.filter(char => 
    char.title?.toLowerCase().includes(searchText) ||
    char.description?.toLowerCase().includes(searchText)
  );
});
```

#### 新增方法
```javascript
// 加载角色列表
const loadCharacters = async () => {
  try {
    const response = await apiService.fetchCharacters('private');
    characters.value = response.items || [];
    
    // 优先使用上次选择的角色
    if (characters.value.length > 0) {
      const savedCharacter = characters.value.find(c => c.id === lastSelectedCharacterId.value);
      if (savedCharacter) {
        currentSession.value.character_id = savedCharacter.id;
      } else {
        // 如果没有保存的角色，使用第一个
        currentSession.value.character_id = characters.value[0].id;
      }
    }
  } catch (error) {
    console.error('获取角色列表失败:', error);
    notify.error('获取角色列表失败', error);
  }
};

// 选择角色
const selectCharacter = (character) => {
  currentSession.value.character_id = character.id;
  lastSelectedCharacterId.value = character.id;
  showCharacterSelector.value = false;
  characterSearchText.value = '';
};

// 前往角色管理页面
const goToCharactersPage = () => {
  showCharacterSelector.value = false;
  router.push({ name: 'Characters' });
};
```

---

## 🎨 UI 设计

### 1. 未选择角色状态
```
┌─────────────────────────────────────┐
│ ℹ️ 需要选择角色模板                  │
│    请先选择一个角色模板，然后才能   │
│    创建会话                         │
│    [选择角色]                       │
└─────────────────────────────────────┘
```

### 2. 已选择角色状态
```
┌─────────────────────────────────────┐
│ [头像] 角色名称              ▶      │
│        角色描述...                   │
└─────────────────────────────────────┘
```

### 3. 角色选择弹窗
```
┌──────────────────────────────────────┐
│          选择角色                    │
├──────────────────────────────────────┤
│ [🔍 搜索角色...             ] [×]    │
├──────────────────────────────────────┤
│ [头像] 角色 1                        │
│        描述...                 ✓     │
├──────────────────────────────────────┤
│ [头像] 角色 2                        │
│        描述...                       │
├──────────────────────────────────────┤
│ [应用图标] 管理角色    [取消]        │
└──────────────────────────────────────┘
```

---

## 📁 修改文件清单

### 前端文件（1 个）

**`frontend/src/components/CreateSessionChatPanel.vue`**

#### Template 部分修改
1. 修改未选择角色提示 - 将跳转到角色页面的按钮改为打开选择器弹窗
2. 新增已选角色显示区域 - 显示角色头像、名称、描述
3. 新增角色选择弹窗 - 包含搜索框、角色列表、底部按钮
4. 导入新图标组件：`Search`, `CheckCircleFilled`, `ArrowRightTwotone`, `Apps`

#### Script 部分修改
1. 新增角色相关响应式数据
2. 新增 `lastSelectedCharacterId` 本地存储
3. 新增 `currentCharacter` 和 `filteredCharacters` 计算属性
4. 新增 `loadCharacters()` 加载角色方法
5. 新增 `selectCharacter()` 选择角色方法
6. 新增 `goToCharactersPage()` 跳转方法
7. 在 `onMounted` 中调用 `loadCharacters()`

---

## 🔄 工作流程

### 首次访问流程
```
1. 用户访问 /chat/new-session
   ↓
2. onMounted() 触发
   ↓
3. loadCharacters() 加载角色列表
   ↓
4. 检测到无 lastSelectedCharacterId
   ↓
5. 自动选择第一个角色
   ↓
6. 显示已选角色信息
```

### 再次访问流程
```
1. 用户访问 /chat/new-session
   ↓
2. onMounted() 触发
   ↓
3. loadCharacters() 加载角色列表
   ↓
4. 检测到有 lastSelectedCharacterId
   ↓
5. 查找并选中上次选择的角色
   ↓
6. 如果角色不存在，选择第一个
   ↓
7. 显示已选角色信息
```

### 选择角色流程
```
1. 用户点击"选择角色"或已选角色区域
   ↓
2. 打开角色选择弹窗
   ↓
3. 用户可搜索过滤角色列表
   ↓
4. 用户点击某个角色
   ↓
5. selectCharacter() 执行：
   - 更新 currentSession.character_id
   - 保存到 lastSelectedCharacterId
   - 关闭弹窗
   - 清空搜索框
   ↓
6. 显示新选择的角色信息
```

---

## 🧪 测试验证

### 测试用例 1: 首次访问自动选择
**步骤**:
1. 清除浏览器本地存储
2. 访问 `/chat/new-session`
3. 观察角色选择区域

**预期结果**:
- [ ] 自动选中列表中的第一个角色
- [ ] 显示角色头像、名称、描述
- [ ] 可以正常发送消息

### 测试用例 2: 手动选择角色
**步骤**:
1. 点击"选择角色"按钮
2. 在弹窗中选择一个不同的角色
3. 观察变化

**预期结果**:
- [ ] 弹窗正常打开
- [ ] 可以看到所有角色列表
- [ ] 点击角色后正确选中
- [ ] 弹窗自动关闭
- [ ] 主页面显示新选择的角色

### 测试用例 3: 搜索角色
**步骤**:
1. 打开角色选择弹窗
2. 在搜索框输入关键字
3. 观察列表过滤效果

**预期结果**:
- [ ] 搜索框正常工作
- [ ] 列表实时过滤
- [ ] 支持标题和描述搜索
- [ ] 无匹配时显示空状态

### 测试用例 4: 本地存储持久化
**步骤**:
1. 选择一个角色
2. 刷新页面
3. 重新访问 `/chat/new-session`

**预期结果**:
- [ ] 刷新后仍保持选中的角色
- [ ] 再次访问时自动选中上次选择的角色
- [ ] 本地存储中存在 `lastSelectedCharacterId`

### 测试用例 5: 角色不存在处理
**步骤**:
1. 选择一个角色并记录 ID
2. 在本地存储中删除该角色（模拟后端删除）
3. 刷新页面

**预期结果**:
- [ ] 找不到上次选择的角色
- [ ] 自动选择第一个可用角色
- [ ] 不出现错误

---

## 💡 技术要点

### 1. 本地存储使用
```javascript
import { useStorage } from "@vueuse/core"
const lastSelectedCharacterId = useStorage('lastSelectedCharacterId', '');
```
- 使用 VueUse 的 `useStorage` 实现响应式本地存储
- 自动序列化和反序列化
- 提供默认值防止未定义错误

### 2. 搜索过滤逻辑
```javascript
const filteredCharacters = computed(() => {
  if (!characterSearchText.value) {
    return characters.value;
  }
  const searchText = characterSearchText.value.toLowerCase();
  return characters.value.filter(char => 
    char.title?.toLowerCase().includes(searchText) ||
    char.description?.toLowerCase().includes(searchText)
  );
});
```
- 使用 `computed` 实现响应式过滤
- 支持标题和描述双向搜索
- 忽略大小写
- 空搜索时返回全部

### 3. 角色选择逻辑
```javascript
const selectCharacter = (character) => {
  currentSession.value.character_id = character.id;
  lastSelectedCharacterId.value = character.id;  // 保存到本地
  showCharacterSelector.value = false;           // 关闭弹窗
  characterSearchText.value = '';                // 清空搜索
};
```

---

## 📊 数据流图

```
用户操作
   ↓
[选择角色按钮] ──→ 打开弹窗 ──→ [搜索过滤] ──→ 显示过滤结果
                                     ↓
                                [点击角色]
                                     ↓
                            selectCharacter()
                             ↙         ↘
       更新 currentSession     保存到 localStorage
           ↓                        ↓
   显示新角色信息            下次访问自动选中
```

---

## ⚠️ 注意事项

1. **角色列表加载失败处理**
   - 添加错误提示
   - 不影响模型选择等其他功能
   
2. **空列表处理**
   - 无角色时显示友好提示
   - 引导用户创建角色

3. **性能优化**
   - 使用 `computed` 缓存过滤结果
   - 只在必要时重新计算

4. **用户体验**
   - 选中角色有视觉反馈（蓝色背景 + 勾选图标）
   - 搜索框支持一键清空
   - 提供"管理角色"快捷入口

---

## 🚀 后续优化建议

1. **角色分组**
   - 按类型分组显示（工作/学习/娱乐）
   - 添加分组折叠/展开功能

2. **最近使用**
   - 在弹窗顶部显示最近使用的角色
   - 快速访问常用角色

3. **快捷键支持**
   - Ctrl+K 快速打开角色选择
   - Esc 关闭弹窗

4. **角色预览**
   - 鼠标悬停显示角色详情
   - 快速查看角色设定

---

**实现日期**: 2026-03-23  
**版本**: v1.0.0  
**状态**: 待测试验证
