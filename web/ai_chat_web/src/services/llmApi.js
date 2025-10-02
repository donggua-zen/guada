class ApiService {
  constructor(baseURL = '/v1') {
    this.baseURL = baseURL;
    this.currentAbortController = null;
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
  async updateCharacter(characterId, config) {
    const data = await this._request(`/characters/${characterId}`, {
      method: 'PUT',
      body: {
        title: config.title,
        name: config.name,
        identity: config.identity,
        detailed_setting: config.detailed_setting,
      },
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
    const data = await this._request('/sessions', {
      method: 'POST',
      body: { user_id: userId, character_id: characterId },
    });
    return data.data;
  }

  // 获取会话配置
  async fetchSessionConfig(sessionId) {
    const data = await this._request(`/sessions/${sessionId}`);
    return data.data;
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
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`获取响应失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

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
      this.currentAbortController = null;
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
  async updateSession(sessionId, config) {
    const data = await this._request(`/sessions/${sessionId}`, {
      method: 'PUT',
      body: {
        model: config.model,
        memory_type: config.memory_type,
      },
    });
    return data.data;
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
}

// 创建默认实例并导出
export const apiService = new ApiService("http://localhost:5000/v1");