let currentAbortController = null;
let isStreaming = false;

async function fetchModels() {
    try {
        const response = await fetch('/v1/models', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`获取模型列表失败: ${response.status}`);
        }

        const data = await response.json();
        return data.data.models || [];

    } catch (error) {
        console.error('获取模型列表失败:', error);
        return [
        ]; // 默认值
    }
}

// llm_api.js 中添加以下函数
async function createCharacter(characterData) {
    try {
        const response = await fetch('/v1/characters', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(characterData)
        });

        if (!response.ok) {
            throw new Error(`创建角色失败: ${response.status}`);
        }

        const data = await response.json();
        return data.data;

    } catch (error) {
        console.error('创建角色失败:', error);
        throw error;
    }
}

async function deleteCharacter(characterId) {
    try {
        const response = await fetch('/v1/characters/' + characterId, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`删除角色失败: ${response.status}`);
        }

        const data = await response.json();
        return data.data;

    } catch (error) {
        console.error('删除角色失败:', error);
        throw error;
    }
}

async function fetchCharacters() {
    try {
        const response = await fetch('/v1/characters', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`获取角色列表失败: ${response.status}`);
        }

        const data = await response.json();
        return data.data || {};

    } catch (error) {
        console.error('获取角色列表失败:', error);
        return {}
    }
}

async function fetchCharacter(characterId) {

    try {
        const response = await fetch(`/v1/characters/${characterId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`获取角色失败: ${response.status}`);
        }

        const data = await response.json();
        return data.data || {};

    } catch (error) {
        console.error('获取角色失败:', error);
        return null; // 默认值
    }
}

async function queryOrCreateSession(userId, characterId) {
    try {
        const response = await fetch('/v1/sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ user_id: userId, character_id: characterId })
        });

        if (!response.ok) {
            throw new Error(`创建或查询会话失败: ${response.status}`);
        }

        const data = await response.json();
        return data.data;

    } catch (error) {
        console.error('创建或查询会话失败:', error);
        return null; // 默认值
    }
}

async function clearSessionMessages(session_id) {
    try {
        const response = await fetch(`/v1/sessions/${session_id}/messages`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`清除会话消息失败: ${response.status}`);
        }

        return true;

    } catch (error) {
        console.error('清除会话消息失败:', error);
        return false; // 默认值
    }
}


/**
 * 获取会话列表
 * @returns {Promise<Array>} 解析为会话数组的Promise
 */
async function fetchSessions() {
    try {
        const response = await fetch('/v1/sessions', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`获取会话列表失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.data;  // 返回会话数组

    } catch (error) {
        console.error('获取会话列表失败:', error);
        return [];  // 返回空数组
    }
}

/**
 * 异步获取当前会话的配置信息（包括角色设定）
 * @returns {Promise<Object>} 解析为会话配置对象的Promise
 */
async function fetchSessionConfig(sessionId) {

    try {
        const response = await fetch('/v1/sessions/' + sessionId, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // 如果需要认证: 'Authorization': 'Bearer YOUR_TOKEN'
            },
        });

        if (!response.ok) {
            throw new Error(`获取会话配置失败: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.data;

    } catch (error) {
        console.error('获取会话配置失败:', error);
        // 返回默认配置
        return {
        };
    }
}


/**
 * 异步获取完整的聊天历史记录
 * @returns {Promise<Array>} 解析为消息数组的Promise
 */
async function fetchFullHistory(sessionId) {
    try {
        const response = await fetch('/v1/sessions/' + sessionId + '/messages', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // 如果需要认证: 'Authorization': 'Bearer YOUR_TOKEN'
            }
        });

        if (!response.ok) {
            throw new Error(`服务器错误: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.data || [];  // 返回消息数组

    } catch (error) {
        console.error('获取历史记录失败:', error);
        // 可以在这里添加UI错误处理
        return [];  // 返回空数组避免后续处理出错
    }
}

async function* fetchResponse(sessionId, messageId, enableReasoning) {
    const controller = new AbortController();
    currentAbortController = controller;
    try {
        const response = await fetch("/v1/sessions/" + sessionId + "/messages/stream", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                message: { role: "user", "message_id": messageId },
                stream: true,
                enable_reasoning: enableReasoning  // 添加深度思考参数
            }),
            signal: controller.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            if (!isStreaming)
                break;
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let boundary;
            while ((boundary = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, boundary).trim();
                buffer = buffer.substring(boundary + 1);

                if (line === 'data: [DONE]') return;  // 流结束

                if (line.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(line.substring(6)); // 移除 "data: "
                        yield json;
                    } catch (e) {
                        console.error("JSON解析失败:", e);
                    }
                }
            }
        }
    } finally {
        if (currentAbortController) {
            controller.abort();
            currentAbortController = null;
        }
    }
}

async function deleteMessage(messageId) {
    try {
        const response = await fetch(`/v1/messages/${messageId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error(`删除消息失败: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('删除消息失败:', error);
        throw error;
    }
}

async function updateMessage(messageId, content) {
    try {
        const response = await fetch(`/v1/messages/${messageId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: content
            })
        });

        if (!response.ok) {
            throw new Error(`更新消息失败: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('更新消息失败:', error);
        throw error;
    }
}

async function addMessage(sessionId, content) {
    try {
        const response = await fetch(`/v1/sessions/${sessionId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: content
            })
        });

        if (!response.ok) {
            throw new Error(`发生消息失败: ${response.status}`);
        }

        const data = await response.json();
        return data.data || {};  // 确保返回一个对象，以防万一
    } catch (error) {
        console.error('发生消息失败:', error);
        throw error;
    }
}
// llm_api.js

// 防抖函数 (防止频繁调用)
function debounce(func, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

/**
 * 保存角色配置到后端
 * @param {Object} config - 角色配置对象
 * @param {string} config.name - 角色名称
 * @param {string} config.setup - 角色设定
 * @param {string} config.style - 回复风格
 * @param {string} config.model_id - 模型ID
 */
async function updateCharacter(characterId, config) {
    try {
        const response = await fetch('/v1/characters/' + characterId, {
            method: 'PUT', // 使用PUT方法更新配置
            headers: {
                'Content-Type': 'application/json',
                // 如果需要认证: 'Authorization': 'Bearer YOUR_TOKEN'
            },
            body: JSON.stringify({
                title: config.title,
                name: config.name,
                identity: config.identity,
                detailed_setting: config.detailed_setting,
            })
        });

        if (!response.ok) {
            throw new Error(`保存配置失败: ${response.status} ${response.statusText}`);
        }

        console.log('角色配置保存成功');
        return await response.json();

    } catch (error) {
        console.error('保存角色配置失败:', error);
    }
}

async function updateSession(sessionId, config) {
    try {
        const response = await fetch('/v1/sessions/' + sessionId, {
            method: 'PUT', // 使用PUT方法更新配置
            headers: {
                'Content-Type': 'application/json',
                // 如果需要认证: 'Authorization': 'Bearer YOUR_TOKEN'
            },
            body: JSON.stringify({
                model: config.model,
                memory_type: config.memory_type
            })
        });

        if (!response.ok) {
            throw new Error(`保存会话设置失败: ${response.status} ${response.statusText}`);
        }

        console.log('会话设置保存成功');
        return await response.json();

    } catch (error) {
        console.error('保存会话设置失败:', error);
    }
}

// 创建防抖版本的保存函数 (500ms防抖)
const debouncedUpdateCharacter = debounce(updateCharacter, 500);
const debouncedUpdateSesssion = debounce(updateSession, 500);