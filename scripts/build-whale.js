const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const whaleDistDir = path.join(rootDir, 'extensions/chrome/dist-whale');
const releasesWhaleDir = path.join(rootDir, 'releases/whale');

if (fs.existsSync(whaleDistDir)) fs.rmSync(whaleDistDir, { recursive: true, force: true });
if (!fs.existsSync(releasesWhaleDir)) fs.mkdirSync(releasesWhaleDir, { recursive: true });

// 1. 自动编译 Chrome 源码
const chromeDistDir = path.join(rootDir, 'extensions/chrome/dist');
try {
    const { execSync } = require('child_process');
    console.log('⚙️ 正在重新编译 Chrome 源码...');
    execSync('node build.js', { cwd: path.join(rootDir, 'extensions/chrome'), stdio: 'inherit' });
} catch (e) {
    console.error('❌ Chrome 编译失败，中止 Whale 打包');
    process.exit(1);
}

// 2. 复制 Chrome 的构建产物
console.log('📦 正在复制 Chrome 构建产物以生成 Whale 专用版...');
fs.cpSync(chromeDistDir, whaleDistDir, { recursive: true });

// 3. 修改 manifest.json
const manifestPath = path.join(whaleDistDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 🌟 核心修改：强制覆盖 Whale 的版本号，避免小于商店的 1.2.71
const WHALE_VERSION = "1.2.82";
manifest.version = WHALE_VERSION;

// 移除 Whale 不支持的 identity 权限，移除商店专用的 key
if (manifest.permissions) {
    manifest.permissions = manifest.permissions.filter(p => p !== 'identity');
}
delete manifest.key;

// 4. 写入新 manifest
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// 5. 打包成 zip
const zipName = `whale-v${WHALE_VERSION}.zip`;
const zipPath = path.join(releasesWhaleDir, zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

try {
    const { execSync } = require('child_process');
    execSync(`cd "${whaleDistDir}" && zip -r "${zipPath}" ./*`, { stdio: 'inherit' });
    console.log(`✅ Whale 版本生成成功: ${zipPath} (内部版本号已强制设为 ${WHALE_VERSION})`);
} catch (e) {
    console.log(`⚠️ 打包 zip 失败，但 dist-whale 目录已生成。`);
}
