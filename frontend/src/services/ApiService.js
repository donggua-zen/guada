class ApiService {
  constructor(baseURL = '/v1') {
    this.baseURL = baseURL;

    this.currentAbortController = null;
    this.abortControllerMap = new Map();
  }

  /**
   * 通用请求方法
   * @param {string} endpoint - API端点
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 返回解析后的JSON数据
   */
  async _request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status} ${response.statusText}`);
      }

      const response_json = await response.json();
      if (!response_json.success) {
        throw new Error(response_json.error);
      }
      return response_json.data;
    } catch (error) {
      console.error(`API请求失败: ${endpoint}`, error);
      throw error;
    }
  }

  /**
   * 获取模型列表
   * @returns {Promise<Array>} 返回模型数组
   */
  async fetchModels() {
    return await this._request('/models');
  }

  /**
   * 获取角色列表
   * @returns {Promise<Object>} 返回角色数据对象
   */
  async fetchCharacters() {
    return await this._request('/characters');
  }

  /**
   * 获取特定角色信息
   * @param {string} characterId - 角色ID
   * @returns {Promise<Object|null>} 返回角色数据或null
   */
  async fetchCharacter(characterId) {
    return await this._request(`/characters/${characterId}`);
  }

  /**
   * 创建新角色
   * @param {Object} characterData - 角色数据
   * @returns {Promise<Object>} 返回创建的角色数据
   */
  async createCharacter(characterData) {
    return await this._request('/characters', {
      method: 'POST',
      body: characterData,
    });
  }

  /**
   * 更新角色信息
   * @param {string} characterId - 角色ID
   * @param {Object} characterData - 更新的角色数据
   * @returns {Promise<Object>} 返回更新后的角色数据
   */
  async updateCharacter(characterId, characterData) {
    return await this._request(`/characters/${characterId}`, {
      method: 'PUT',
      body: characterData,
    });
  }

  /**
   * 删除角色
   * @param {string} characterId - 角色ID
   * @returns {Promise<Object>} 返回删除结果
   */
  async deleteCharacter(characterId) {
    return await this._request(`/characters/${characterId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 查询或创建会话
   * @param {string} userId - 用户ID
   * @param {string} characterId - 角色ID
   * @returns {Promise<Object>} 返回会话数据
   */
  async queryOrCreateSession(userId, characterId) {
    return await this._request('/sessions_', {
      method: 'POST',
      body: { user_id: userId, character_id: characterId },
    });
  }

  /**
   * 创建新会话
   * @param {string} title - 会话标题
   * @param {string} [characterId] - 角色ID（可选）
   * @returns {Promise<Object>} 返回创建的会话数据
   */
  async createSession(title, characterId = undefined) {
    return await this._request('/sessions', {
      method: 'POST',
      body: { title: title, character_id: characterId },
    });
  }

  /**
   * 删除会话
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 返回删除结果
   */
  async deleteSession(sessionId) {
    return await this._request(`/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 获取会话配置
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 返回会话数据
   */
  async fetchSession(sessionId) {
    return await this._request(`/sessions/${sessionId}`);
  }

  /**
   * 获取所有会话
   * @returns {Promise<Array>} 返回会话数组
   */
  async fetchSessions() {
    return await this._request('/sessions');
  }

  /**
   * 获取会话消息历史
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Array>} 返回消息数组
   */
  async fetchSessionMessages(sessionId) {
    return await this._request(`/sessions/${sessionId}/messages`);
  }

  async importMessages(sessionId, messages) {
    return await this._request(`/sessions/${sessionId}/messages/import`, {
      method: 'POST',
      body: messages,
    });
  }

  /**
   * 添加消息到会话
   * @param {string} sessionId - 会话ID
   * @param {string} content - 消息内容
   * @returns {Promise<Array>} 返回消息数据
   */
  async createMessage(sessionId, content) {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: {
        content: content
      },
    });
  }

  /**
   * 获取会话的token统计信息
   * @param {string} sessionId - 会话ID
   * @returns {Promise<Object>} 返回token统计数据
   */
  async fetchTokenStatistics(sessionId) {
    return await this._request(`/sessions/${sessionId}/tokens`);
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
    // this.currentAbortController = new AbortController();
    try {
      this.cancelResponse(sessionId);
      const controller = new AbortController();
      this.abortControllerMap.set(sessionId, controller);
      const response = await fetch(`${this.baseURL}/sessions/${sessionId}/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message_id: messageId,
          assistant_message_id: assistant_message_id,
          regeneration_mode: regeneration_mode,
          stream: true,
          enable_reasoning: enableReasoning,
        }),
        signal: controller.signal,
      });

      // 检查响应头中的 Content-Type
      const contentType = response.headers.get('Content-Type');

      // if (!response.ok) {
      // 如果是 JSON 错误响应，解析错误信息
      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(errorData.error || `获取响应失败: ${response.status}`);
      }
      // else {
      //   throw new Error(`获取响应失败: ${response.status} ${response.statusText}`);
      // }
      //  }

      // // 根据 Content-Type 判断响应类型
      // if (contentType && contentType.includes('application/json')) {
      //   // 如果是 JSON 响应，直接返回解析后的数据
      //   const data = await response.json();
      //   yield data;
      //   return;
      // }


      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let boundary;
          while ((boundary = buffer.indexOf('\n')) !== -1) {
            const line = buffer.substring(0, boundary).trim();
            buffer = buffer.substring(boundary + 1);

            if (line === 'data: [DONE]') return;

            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.substring(6));
                yield json;
              } catch (e) {
                console.error('JSON解析失败:', e, line);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      this.abortControllerMap.delete(sessionId);
    }
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
    const formData = new FormData();
    formData.append('avatar', avatarFile);

    try {
      // 发送POST请求上传头像文件

      const url = type === 'character' ? 'characters' : 'sessions';

      const response = await fetch(`${this.baseURL}/${url}/${uid}/avatars`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`上传头像失败: ${response.status}`);
      }

      const json = await response.json();
      if (!json.success) {
        throw new Error(json.error);
      }
      return json.data || [];
    } catch (error) {
      console.error('上传错误:', error);
      throw error;
    }
  }


  /**
   * 上传文件到指定消息
   * @param {string} messageId - 消息ID，用于标识文件关联的消息
   * @param {File} file - 要上传的文件对象
   * @returns {Promise<Array|Object>} 返回解析后的数据，如果json.data存在则返回该数据，否则返回空数组
   * @throws {Error} 当上传失败或服务器返回错误时抛出异常
   */
  async uploadFile(messageId, file) {
    // 创建表单数据对象并附加文件
    const formData = new FormData();
    formData.append('file', file);

    try {
      // 发送文件上传请求到服务器
      const response = await fetch(`${this.baseURL}/messages/${messageId}/files`, {
        method: 'POST',
        body: formData,
      });

      // 检查响应状态是否成功
      if (!response.ok) {
        throw new Error(`文件上传失败: ${response.status}`);
      }

      // 解析JSON响应数据
      const json = await response.json();
      // 检查服务器返回的成功标志
      if (!json.success) {
        throw new Error(json.error);
      }
      return json.data || [];
    } catch (error) {
      // 记录错误日志并重新抛出异常
      console.error('上传错误:', error);
      throw error;
    }
  }

  async webSearch(messageId) {
    return await this._request(`/messages/${messageId}/web_serach`, {
      method: 'GET',
    });
  }

  /**
   * 删除消息
   * @param {string} messageId - 消息ID
   * @returns {Promise<Object>} 返回删除结果
   */
  async deleteMessage(messageId) {
    return await this._request(`/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 更新消息内容
   * @param {string} messageId - 消息ID
   * @param {string} content - 新的消息内容
   * @returns {Promise<Object>} 返回更新结果
   */
  async updateMessage(messageId, content) {
    return await this._request(`/messages/${messageId}`, {
      method: 'PUT',
      body: { content },
    });
  }


  async setMessageCurrentContent(messageId, contentId) {
    return await this._request(`/message-content/${contentId}/active`, {
      method: 'PUT',
      body: { message_id: messageId },
    });
  }

  /**
   * 清空会话消息
   * @param {string} sessionId - 会话ID
   * @returns {Promise<boolean>} 返回操作是否成功
   */
  async clearSessionMessages(sessionId) {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: 'DELETE',
    });
  }

  /**
   * 更新会话配置
   * @param {string} sessionId - 会话ID
   * @param {Object} data - 更新的数据
   * @returns {Promise<Object>} 返回更新后的会话数据
   */
  async updateSession(sessionId, data) {
    return await this._request(`/sessions/${sessionId}`, {
      method: 'PUT',
      body: data,
    });
  }

  /**
   * 取消当前请求
   */
  abortCurrentRequest() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * 防抖函数
   * @param {Function} func - 需要防抖的函数
   * @param {number} delay - 延迟时间（毫秒）
   * @returns {Function} 返回防抖后的函数
   */
  debounce(func, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }


  /**
   * 获取模型列表（重复方法，建议移除其中一个）
   * @returns {Promise<Object>} 返回模型和提供商数据
   */
  async fetchModels() {
    return await this._request('/models');
  }

  /**
   * 创建模型
   * @param {Object} data - 模型数据
   * @returns {Promise<Object>} 返回创建的模型数据
   */
  async createModel(data) {
    return await this._request('/models', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * 删除模型
   * @param {string} modelId - 模型ID
   * @returns {Promise<boolean>} 返回操作是否成功
   */
  async deleteModel(modelId) {
    return await this._request(`/models/${modelId}`, {
      method: 'DELETE',
    });
  }

  /**
   * 更新模型
   * @param {string} modelId - 模型ID
   * @param {Object} data - 更新的模型数据
   * @returns {Promise<Object>} 返回更新后的模型数据
   */
  async updateModel(modelId, data) {
    return await this._request(`/models/${modelId}`, {
      method: 'PUT',
      body: data,
    });
  }

  /**
   * 创建提供商
   * @param {Object} data - 提供商数据
   * @returns {Promise<Object>} 返回创建的提供商数据
   */
  async createProvider(data) {
    return await this._request('/providers', {
      method: 'POST',
      body: data,
    });
  }

  /**
   * 删除提供商
   * @param {string} providerId - 提供商ID
   * @returns {Promise<boolean>} 返回操作是否成功
   */
  async deleteProvider(providerId) {
    return await this._request(`/providers/${providerId}`, {
      method: 'DELETE',
    });

  }

  /**
   * 更新指定ID的提供者信息
   *
   * @param {string} providerId 要更新的提供者ID
   * @param {Object} data 要更新的提供者数据
   * @returns {Promise<Object>} 更新后的提供者数据
   * @throws {Error} 如果更新失败则抛出错误
   */
  async updateProvider(providerId, data) {
    return await this._request(`/providers/${providerId}`, {
      method: 'PUT',
      body: data,
    });
  }


  async fetchSettings() {
    return await this._request('/settings');
  }

  async updateSettings(data) {
    return await this._request('/settings', {
      method: 'PUT',
      body: data,
    });
  }

}

// 创建默认实例并导出
export const apiService = new ApiService("/v1");
