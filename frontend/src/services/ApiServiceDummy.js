class ApiServiceDummy {
  constructor(baseURL = '/v1') {
    this.baseURL = baseURL;
    this.currentAbortController = null;
    this.abortControllerMap = new Map();
  }


  /**
   * 获取模型列表
   * @returns {Promise<Array>} 返回模型数组
   */
  async fetchModels() {

  }

  async fetchRemoteModels(provider_id) {

  }

  /**
   * 获取角色列表
   * @returns {Promise<Object>} 返回角色数据对象
   */
  async fetchCharacters(type = 'private') {

  }

  /**
   * 获取特定角色信息
   * @param {string} characterId - 角色ID
   * @returns {Promise<Object|null>} 返回角色数据或null
   */
  async fetchCharacter(characterId) {

  }

  /**
   * 创建新角色
   * @param {Object} characterData - 角色数据
   * @returns {Promise<Object>} 返回创建的角色数据
   */
  async createCharacter(characterData) {

  }

  /**
   * 更新角色信息
   * @param {string} characterId - 角色ID
   * @param {Object} characterData - 更新的角色数据
   * @returns {Promise<Object>} 返回更新后的角色数据
   */
  async updateCharacter(characterId, characterData) {

  }

  /**
   * 删除角色
   * @param {string} characterId - 角色ID
   * @returns {Promise<Object>} 返回删除结果
   */
  async deleteCharacter(characterId) {

  }

  /**
   * 创建新会话
   * @param {string} data - 创建会话信息
   * @param {string} [characterId] - 角色ID（可选）
   * @returns {Promise<Object>} 返回创建的会话数据
   */
  async createSession(data) {

  }

  /**
   * 删除会话
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 返回删除结果
   */
  async deleteSession(sessionId) {

  }

  /**
   * 获取会话配置
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 返回会话数据
   */
  async fetchSession(sessionId) {
  }

  /**
   * 获取所有会话
   * @returns {Promise<Array>} 返回会话数组
   */
  async fetchSessions() {
  }

  /**
   * 获取会话消息历史
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Array>} 返回消息数组
   */
  async fetchSessionMessages(sessionId) {
  }

  async importMessages(sessionId, messages) {

  }

  /**
   * 添加消息到会话
   * @param {string} sessionId - 会话ID
   * @param {string} content - 消息内容
   * @returns {Promise<Array>} 返回消息数据
   */
  async createMessage(sessionId, content, files = [], replaceMessageId = null) {

  }

  /**
   * 获取会话的token统计信息
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 返回token统计数据
   */
  async fetchTokenStatistics(sessionId) {
  }

  /**
   * 流式获取AI响应
   * @param {string} sessionId - 会话ID
   * @param {string} messageId - 消息ID
   * @param {boolean} enableReasoning - 是否启用推理
   * @param {AbortController} abortController - 取消控制器
   * @yields {Object} 返回流式响应数据
   */
  async *chat(sessionId, messageId, regeneration_mode = null, assistant_message_id = null, enableReasoning = false,) {
    // 模拟创建消息
    yield {
      type: "create",
      message_id: "dummy-assistant-message-id",
      content_id: "dummy-content-id",
      model_name: "Dummy Model"
    };

    // 模拟网络搜索
    yield {
      type: "web_search",
      msg: "start"
    };

    yield {
      type: "web_search",
      msg: "end"
    };



    yield {
      type: "think",
      msg: "正在分析问题..."
    };

    // 模拟逐步思考过程
    const thoughts = [
      "\n\n首先，我需要理解用户的问题。",
      "\n然后，我会考虑相关的知识点。",
      "\n最后，我会组织语言给出详细回答。"
    ];
    for (let i = 0; i < 5; i++) {
      for (const thought of thoughts) {
        yield {
          type: "think",
          msg: thought
        };
        // 模拟延迟
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }


    // 模拟实际回答内容
    const responseText = "# 这是一个标题\n\n" +
      "这是模拟的回答内容。通过这个模拟函数，我们可以在没有真实API的情况下测试界面交互和功能。\n\n" +
      "## 文本样式示例\n\n" +
      "我们可以使用 **粗体**、*斜体* 和 ~~删除线~~ 来强调文本。\n\n" +
      "## 列表示例\n\n" +
      "模拟的内容包括：\n" +
      "1. 消息创建过程\n" +
      "2. 网络搜索提示\n" +
      "3. 思考过程（可选）\n" +
      "4. 实际回答内容\n\n" +
      "无序列表：\n" +
      "- 功能测试\n" +
      "- 界面优化\n" +
      "- 性能调试\n\n" +
      "## 代码示例\n\n" +
      "行内代码：使用 `console.log()` 输出信息。\n\n" +
      "代码块：\n" +
      "```javascript\n" +
      "// 这是一个JavaScript示例\n" +
      "function helloWorld() {\n" +
      "  console.log('Hello, world!');\n" +
      "}\n" +
      "```\n\n" +
      "## 引用示例\n\n" +
      "> 这是一个引用块。通过模拟数据，开发者可以在没有后端支持的情况下测试前端功能。\n\n" +
      "## 链接和图片\n\n" +
      "你可以访问 [Vue.js官网](https://vuejs.org) 获取更多信息。\n\n" +
      "## 表格示例\n\n" +
      "| 功能 | 描述 | 状态 |\n" +
      "| ---- | ---- | ---- |\n" +
      "| 消息创建 | 创建新消息 | ✅ 已完成 |\n" +
      "| 流式响应 | 模拟AI逐步回复 | ✅ 已完成 |\n" +
      "| Markdown渲染 | 渲染Markdown格式 | ✅ 已完成 |\n\n" +
      "## 水平分割线\n\n" +
      "这样开发者就可以在开发过程中方便地进行调试和界面优化。\n\n" +
      "---\n\n" +
      "感谢使用我们的模拟API服务！";
    for (let i = 0; i < 3; i++) {
      for (let y = 0; y < responseText.length; y++) {
        yield {
          type: "text",
          msg: responseText.charAt(y)
        };
        // 模拟打字效果
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    // 模拟结束
    yield {
      type: "finish",
      finish_reason: "stop"
    };
  }

  /**
   * 取消响应请求
   * @param {string} sessionId - 会话ID
   */
  async cancelResponse(sessionId) {
    const abortController = this.abortControllerMap.get(sessionId);
    if (abortController) {
      abortController.abort();
    }
  }

  /**
   * 上传头像
   * @param {string} uid - 用户或角色ID
   * @param {File} avatarFile - 头像文件
   * @param {string} type - 上传类型 ('character' 或 'session')
   * @returns {Promise<Array>} 返回上传结果
   */
  async uploadAvatar(uid, avatarFile, type = 'character') {

  }

  async uploadUserAvatar(avatarFile) {

  }

  /**
   * 上传文件到指定消息
   * @param {string} sessionId - 会话ID
   * @param {File} file - 要上传的文件对象
   * @returns {Promise<Array|Object>} 返回解析后的数据
   * @throws {Error} 当上传失败或服务器返回错误时抛出异常
   */
  async uploadFile(sessionId, file) {

  }

  async copyMessageFile(messageId, fileId) {

  }

  async webSearch(messageId) {

  }

  /**
   * 删除消息
   * @param {string} messageId - 消息ID
   * @returns {Promise<Object>} 返回删除结果
   */
  async deleteMessage(messageId) {

  }

  /**
   * 更新消息内容
   * @param {string} messageId - 消息ID
   * @param {string} content - 新的消息内容
   * @returns {Promise<Object>} 返回更新结果
   */
  async updateMessage(messageId, content) {

  }

  async setMessageCurrentContent(messageId, contentId) {

  }

  /**
   * 清空会话消息
   * @param {string} sessionId - 会话ID
   * @returns {Promise<boolean>} 返回操作是否成功
   */
  async clearSessionMessages(sessionId) {

  }

  /**
   * 更新会话配置
   * @param {string} sessionId - 会话ID
   * @param {Object} data - 更新的数据
   * @returns {Promise<Object>} 返回更新后的会话数据
   */
  async updateSession(sessionId, data) {

  }

  /**
   * 取消当前请求
   */
  abortCurrentRequest() {

  }

  /**
   * 防抖函数
   * @param {Function} func - 需要防抖的函数
   * @param {number} delay - 延迟时间（毫秒）
   * @returns {Function} 返回防抖后的函数
   */
  debounce(func, delay) {

  }

  /**
   * 创建模型
   * @param {Object} data - 模型数据
   * @returns {Promise<Object>} 返回创建的模型数据
   */
  async createModel(data) {

  }

  /**
   * 删除模型
   * @param {string} modelId - 模型ID
   * @returns {Promise<boolean>} 返回操作是否成功
   */
  async deleteModel(modelId) {

  }

  /**
   * 更新模型
   * @param {string} modelId - 模型ID
   * @param {Object} data - 更新的模型数据
   * @returns {Promise<Object>} 返回更新后的模型数据
   */
  async updateModel(modelId, data) {

  }

  /**
   * 创建提供商
   * @param {Object} data - 提供商数据
   * @returns {Promise<Object>} 返回创建的提供商数据
   */
  async createProvider(data) {

  }

  /**
   * 删除提供商
   * @param {string} providerId - 提供商ID
   * @returns {Promise<boolean>} 返回操作是否成功
   */
  async deleteProvider(providerId) {

  }

  /**
   * 更新指定ID的提供者信息
   * @param {string} providerId - 要更新的提供者ID
   * @param {Object} data - 要更新的提供者数据
   * @returns {Promise<Object>} 更新后的提供者数据
   */
  async updateProvider(providerId, data) {

  }

  async fetchSettings() {
  }

  async updateSettings(data) {

  }


  // ========== 认证相关接口 ==========

  /**
   * 用户登录
   * @param {Object} credentials - 登录凭据
   * @returns {Promise<Object>} 返回登录结果
   */
  async login(credentials) {

  }

  async getProfile() {

  }

  async updateProfile(data) {

  }

  async changePassword(oldPassword, newPassword) {

  }

  async createSubaccount(data) {

  }

  async updateSubaccount(subaccountId, data) {

  }

  async deleteSubaccount(subaccountId) {

  }

  async fetchSubaccounts() {

  }

  async checkResetPassword() {

  }

  async resetPrimayPassword(data) {

  }

}

// 创建默认实例并导出
export const apiServiceDummy = new ApiServiceDummy("/api/v1");