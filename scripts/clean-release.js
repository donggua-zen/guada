const fs = require('fs')
const path = require('path')

/**
 * 清理 release 目录。
 * Windows 下若产物文件被外部进程占用（如杀毒/索引/其他应用以共享写方式打开），
 * rmSync 整目录会直接 EPERM 失败。这里逐个删除并容错：
 * 删不掉的文件尝试截断为 0 字节（electron-builder 随后可覆盖写入），
 * 实在无法处理的才告警并跳过。
 */

const releaseDir = path.join(__dirname, '..', 'release')

function tryUnlink(file) {
  try {
    fs.unlinkSync(file)
    return 'deleted'
  } catch (e) {
    if (!/EBUSY|EPERM|ENOENT/.test(e.code || '')) throw e
    // 尝试截断：占用者通常允许共享写入
    try {
      const fd = fs.openSync(file, 'r+')
      fs.ftruncateSync(fd, 0)
      fs.closeSync(fd)
      return 'truncated'
    } catch (e2) {
      return 'locked'
    }
  }
}

if (!fs.existsSync(releaseDir)) {
  console.log('Release directory not found, skipping clean')
  process.exit(0)
}

console.log('Cleaning release directory...')
const failed = []
const stack = [releaseDir]
// 先删文件再删目录（自底向上），目录内只剩锁定文件时目录也删不掉，留给最后处理
while (stack.length) {
  const dir = stack.pop()
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    continue
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      stack.push(full)
    } else {
      if (tryUnlink(full) === 'locked') failed.push(full)
    }
  }
}
// 自顶向下删空目录（含失败重试一轮）
for (let pass = 0; pass < 2; pass++) {
  for (const dir of stack.reverse()) {
    try { fs.rmdirSync(dir) } catch {}
  }
}
try { fs.rmdirSync(releaseDir) } catch {}

if (failed.length) {
  console.warn('⚠️  以下文件被占用无法删除（已尝试截断，打包时将被覆盖）:')
  for (const f of failed) console.warn('   ' + f)
} else {
  console.log('✓ Release directory cleaned')
}
