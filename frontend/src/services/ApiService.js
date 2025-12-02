import axios from 'axios';
import { useStorage } from '@vueuse/core';

class ApiService {
  constructor(baseURL = '/v1') {
    this.baseURL = baseURL;
    this.tokenStore = useStorage('token', '');

    // 创建 Axios 实例
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 添加响应拦截器处理通用错误
    this.axiosInstance.interceptors.response.use(
      (response) => {
        // 检查响应中的 success 字段
        if (response.data && !response.data.success) {
          throw new Error(response.data.error || '请求失败');
        }
        return response.data ? response.data.data : response;
      },
      (error) => {
        console.error('API请求失败:', error);
        if (error.status === 401) {
          window.location.href = '/login';
          return;
        }
        throw error;
      }
    );

    // 添加请求拦截器动态设置 token
    this.axiosInstance.interceptors.request.use(
      (config) => {
        // 每次请求前获取最新的 token
        const token = this.tokenStore.value;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );


    this.currentAbortController = null;
    this.abortControllerMap = new Map();
  }

  /**
   * 通用请求方法
   * @param {string} endpoint - API端点
   * @param {Object} options - 请求选项
   * @returns {Promise<any>} 返回解析后的数据
   */
  async _request(endpoint, options = {}) {
    try {
      const response = await this.axiosInstance({
        url: endpoint,
        ...options,
      });
      return response;
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
      data: characterData,
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
      data: characterData,
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
      data: { user_id: userId, character_id: characterId },
    });
  }

  /**
   * 创建新会话
   * @param {string} data - 创建会话信息
   * @param {string} [characterId] - 角色ID（可选）
   * @returns {Promise<Object>} 返回创建的会话数据
   */
  async createSession(data, characterId = undefined) {
    return await this._request('/sessions', {
      method: 'POST',
      data: { ...data, character_id: characterId },
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
      data: messages,
    });
  }

  /**
   * 添加消息到会话
   * @param {string} sessionId - 会话ID
   * @param {string} content - 消息内容
   * @returns {Promise<Array>} 返回消息数据
   */
  async createMessage(sessionId, content, files = [], replaceMessageId = null) {
    return await this._request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      data: {
        content: content,
        files: files,
        replace_message_id: replaceMessageId
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
    // 由于流式请求的特殊性，仍然使用fetch
    try {
      this.cancelResponse(sessionId);
      const controller = new AbortController();
      this.abortControllerMap.set(sessionId, controller);
      const accessToken = this.tokenStore.value;
      const response = await fetch(`${this.baseURL}/sessions/${sessionId}/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
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

      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        throw new Error(errorData.error || `获取响应失败: ${response.status}`);
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
      const url = type === 'character' ? 'characters' : 'sessions';

      const response = await this.axiosInstance.post(`/${url}/${uid}/avatars`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      return response || [];
    } catch (error) {
      console.error('上传错误:', error);
      throw error;
    }
  }

  /**
   * 上传文件到指定消息
   * @param {string} sessionId - 会话ID
   * @param {File} file - 要上传的文件对象
   * @returns {Promise<Array|Object>} 返回解析后的数据
   * @throws {Error} 当上传失败或服务器返回错误时抛出异常
   */
  async uploadFile(sessionId, file) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await this.axiosInstance.post(`/sessions/${sessionId}/files`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      return response || [];
    } catch (error) {
      console.error('上传错误:', error);
      throw error;
    }
  }

  async copyMessageFile(messageId, fileId) {
    return await this._request(`/files/${fileId}`, {
      method: 'PUT',
      data: { type: 'copy', message_id: messageId },
    });
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
      data: { content },
    });
  }

  async setMessageCurrentContent(messageId, contentId) {
    return await this._request(`/message-content/${contentId}/active`, {
      method: 'PUT',
      data: { message_id: messageId },
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
      data: data,
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
   * 创建模型
   * @param {Object} data - 模型数据
   * @returns {Promise<Object>} 返回创建的模型数据
   */
  async createModel(data) {
    return await this._request('/models', {
      method: 'POST',
      data: data,
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
      data: data,
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
      data: data,
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
   * @param {string} providerId - 要更新的提供者ID
   * @param {Object} data - 要更新的提供者数据
   * @returns {Promise<Object>} 更新后的提供者数据
   */
  async updateProvider(providerId, data) {
    return await this._request(`/providers/${providerId}`, {
      method: 'PUT',
      data: data,
    });
  }

  async fetchSettings() {
    return await this._request('/settings');
  }

  async updateSettings(data) {
    return await this._request('/settings', {
      method: 'PUT',
      data: data,
    });
  }


  // ========== 认证相关接口 ==========

  /**
   * 用户登录
   * @param {Object} credentials - 登录凭据
   * @returns {Promise<Object>} 返回登录结果
   */
  async login(credentials) {
    return await this._request('/auth/login', {
      method: 'POST',
      data: credentials
    });
  }
}

// 创建默认实例并导出
export const apiService = new ApiService("/api/v1");