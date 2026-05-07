/**
 * 全局错误处理器
 * 
 * 负责统一处理应用中的未捕获异常，特别是认证过期等需要全局响应的错误。
 */

import { useRouter } from 'vue-router'

let routerInstance: ReturnType<typeof useRouter> | null = null

/**
 * 初始化全局错误处理器
 * 必须在应用启动时调用，传入 router 实例
 */
export function initGlobalErrorHandler(router: ReturnType<typeof useRouter>) {
  routerInstance = router
  
  // 监听未处理的 Promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason
    
    // 检查是否为认证错误
    if (error?.isAuthError || error?.statusCode === 401) {
      console.log('🔐 全局捕获到未处理的认证错误，跳转到登录页')
      handleAuthError()
      // 阻止默认的 console 警告
      event.preventDefault()
    }
  })
  
  // 监听全局错误
  window.addEventListener('error', (event) => {
    const error = event.error
    
    // 检查是否为认证错误
    if (error?.isAuthError || error?.statusCode === 401) {
      console.log('🔐 全局捕获到同步认证错误，跳转到登录页')
      handleAuthError()
    }
  })
  
  console.log('✅ 全局错误处理器已初始化')
}

/**
 * 处理认证错误，执行跳转
 */
function handleAuthError() {
  if (!routerInstance) {
    console.error('❌ Router 实例未初始化，无法执行跳转')
    return
  }
  
  // 避免重复跳转
  // Hash 模式下使用 hash，History 模式下使用 pathname
  const currentPath = window.location.hash ? window.location.hash.substring(1) : window.location.pathname
  if (currentPath === '/login' || currentPath === '') {
    return
  }
  
  routerInstance.replace('/login')
}

/**
 * 手动触发认证错误处理
 * 可在任何地方调用此函数来触发登录跳转
 */
export function triggerAuthRedirect() {
  console.log('🔐 手动触发认证重定向')
  handleAuthError()
}
