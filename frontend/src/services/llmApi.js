class ApiService {
  constructor(baseURL = '/v1') {
    this.baseURL = baseURL;

    this.currentAbortController = null;
    this.abortControllerMap = new Map();
  }

  // 通用请求方法
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

      return await response.json();
    } catch (error) {
      console.error(`API请求失败: ${endpoint}`, error);
      throw error;
    }
  }

  // 获取模型列表
  async fetchModels() {
    const data = await this._request('/models');
    return data.data?.models || [];
  }

  // 获取角色列表
  async fetchCharacters() {
    const data = await this._request('/characters');
    return data.data || {};
  }

  // 获取特定角色信息
  async fetchCharacter(characterId) {
    const data = await this._request(`/characters/${characterId}`);
    return data.data || null;
  }

  // 创建新角色
  async createCharacter(characterData) {
    const data = await this._request('/characters', {
      method: 'POST',
      body: characterData,
    });
    return data.data;
  }

  // 更新角色信息
  async updateCharacter(characterId, characterData) {
    const data = await this._request(`/characters/${characterId}`, {
      method: 'PUT',
      body: characterData,
    });
    return data.data;
  }

  // 删除角色
  async deleteCharacter(characterId) {
    const data = await this._request(`/characters/${characterId}`, {
      method: 'DELETE',
    });
    return data.data;
  }

  // 查询或创建会话
  async queryOrCreateSession(userId, characterId) {
    const data = await this._request('/sessions_', {
      method: 'POST',
      body: { user_id: userId, character_id: characterId },
    });
    return data.data;
  }

  // 查询或创建会话
  async createSession(userId, characterId) {
    const data = await this._request('/sessions', {
      method: 'POST',
      body: { user_id: userId, character_id: characterId },
    });
    return data;
  }

  async deleteSession(sessionId) {
    const data = await this._request(`/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    return data;
  }

  // 获取会话配置
  async fetchSession(sessionId) {
    const data = await this._request(`/sessions/${sessionId}`);
    return data.data;
  }

  async fetchSessions() {
    const data = await this._request('/sessions');
    return data.data || [];
  }
  // 获取会话消息历史
  async fetchSessionMessages(sessionId) {
    const data = await this._request(`/sessions/${sessionId}/messages`);
    return data.data || [];
  }

  // 添加消息到会话
  async addMessage(sessionId, content) {
    const data = await this._request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: {
        content: content
      },
    });
    return data.data || [];
  }

  // 流式获取AI响应
  async *fetchResponse(sessionId, messageId, enableReasoning = false, abortController = null) {
    // this.currentAbortController = new AbortController();
    try {
      this.cancelResponse(sessionId);
      const controller = abortController || new AbortController();
      this.abortControllerMap.set(sessionId, controller);
      const response = await fetch(`${this.baseURL}/sessions/${sessionId}/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: { role: 'user', message_id: messageId },
          stream: true,
          enable_reasoning: enableReasoning,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`获取响应失败: ${response.status}`);
      }

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

  async cancelResponse(sessionId) {
    const abortController = this.abortControllerMap.get(sessionId);
    if (abortController) {
      abortController.abort();
    }
  }

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
      return json.data || [];
    } catch (error) {
      console.error('上传错误:', error);
      throw error;
    }
  }

  // 删除消息
  async deleteMessage(messageId) {
    const data = await this._request(`/messages/${messageId}`, {
      method: 'DELETE',
    });
    return data;
  }

  // 更新消息内容
  async updateMessage(messageId, content) {
    const data = await this._request(`/messages/${messageId}`, {
      method: 'PUT',
      body: { content },
    });
    return data;
  }

  // 清空会话消息
  async clearSessionMessages(sessionId) {
    const data = await this._request(`/sessions/${sessionId}/messages`, {
      method: 'DELETE',
    });
    return data.success;
  }

  // 更新会话配置
  async updateSession(sessionId, data) {
    const response = await this._request(`/sessions/${sessionId}`, {
      method: 'PUT',
      body: data,
    });
    return response.data;
  }

  // 取消当前请求
  abortCurrentRequest() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  // 防抖函数
  debounce(func, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }


  // 模型服务
  async getModels() {
    const data = await this._request('/models');
    return data.data || { 'models': [], 'providers': [] };
  }

  async addModel(data) {
    const response = await this._request('/models', {
      method: 'POST',
      body: data,
    });
    return response.data;
  }

  async deleteModel(modelId) {
    const data = await this._request(`/models/${modelId}`, {
      method: 'DELETE',
    });
    return data.success;
  }

  async updateModel(modelId, data) {
    const response = await this._request(`/models/${modelId}`, {
      method: 'PUT',
      body: data,
    });
    return response.data;
  }

  async addProvider(data) {
    const response = await this._request('/providers', {
      method: 'POST',
      body: data,
    });
    if (!response.success) {
      throw new Error(data.error);
    }
    return response.data;
  }

  async deleteProvider(providerId) {
    const data = await this._request(`/providers/${providerId}`, {
      method: 'DELETE',
    });
    return data.success;
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
    const response = await this._request(`/providers/${providerId}`, {
      method: 'PUT',
      body: data,
    });
    if (!response.success) {
      throw new Error(data.error);
    }
    return response.data;
  }

}





// 创建默认实例并导出
export const apiService = new ApiService("/v1");