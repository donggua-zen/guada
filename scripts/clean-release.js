const fs = require('fs')
const path = require('path')

const releaseDir = path.join(__dirname, '..', 'release')
if (fs.existsSync(releaseDir)) {
  console.log('Cleaning release directory...')
  fs.rmSync(releaseDir, { recursive: true, force: true })
  console.log('✓ Release directory cleaned')
} else {
  console.log('Release directory not found, skipping clean')
}
