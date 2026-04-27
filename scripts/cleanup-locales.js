const fs = require('fs');
const path = require('path');

/**
 * 清理不需要的语言包文件，仅保留中英文
 * @param {Object} context - electron-builder 的打包上下文
 */
function cleanupLocales(context) {
  const appOutDir = context.appOutDir;
  const localesDir = path.join(appOutDir, 'locales');
  
  if (!fs.existsSync(localesDir)) {
    console.log('⚠️  Locales directory not found, skipping cleanup');
    return Promise.resolve();
  }
  
  // 需要保留的语言包（中文简体、中文繁体、英文美国、英文英国）
  const keepLocales = [
    'zh-CN.pak',
    'zh-TW.pak', 
    'en-US.pak',
    'en-GB.pak'
  ];
  
  const files = fs.readdirSync(localesDir);
  let removedCount = 0;
  
  files.forEach(file => {
    if (!keepLocales.includes(file)) {
      const filePath = path.join(localesDir, file);
      try {
        fs.unlinkSync(filePath);
        removedCount++;
        console.log(`🗑️  Removed locale: ${file}`);
      } catch (error) {
        console.error(`❌ Failed to remove ${file}:`, error.message);
      }
    }
  });
  
  console.log(`✅ Locale cleanup completed. Removed ${removedCount} language packs.`);
  console.log(`📦 Kept languages: ${keepLocales.join(', ')}`);
  
  return Promise.resolve();
}

module.exports = cleanupLocales;
