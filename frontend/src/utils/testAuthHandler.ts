/**
 * 全局错误处理器测试
 * 
 * 用于验证认证错误处理机制是否正常工作
 */

import { triggerAuthRedirect } from './globalErrorHandler'

/**
 * 模拟 API 调用产生 401 错误
 */
export function simulateAuthError() {
  console.log('模拟认证错误...')
  
  // 模拟一个被 reject 的 Promise
  const authError = new Error('Authentication required')
  ;(authError as any).isAuthError = true
  ;(authError as any).statusCode = 401
  
  // 创建一个未捕获的 Promise rejection
  Promise.reject(authError)
  
  console.log('已触发模拟错误，请观察是否跳转到登录页')
}

/**
 * 测试手动触发跳转
 */
export function testManualRedirect() {
  console.log('测试手动触发认证重定向...')
  triggerAuthRedirect()
}

/**
 * 在控制台运行测试：
 * 
 * // 测试1: 模拟未捕获的 401 错误
 * import { simulateAuthError } from '@/utils/testAuthHandler'
 * simulateAuthError()
 * 
 * // 测试2: 手动触发跳转
 * import { testManualRedirect } from '@/utils/testAuthHandler'
 * testManualRedirect()
 */
