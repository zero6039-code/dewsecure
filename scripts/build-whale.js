const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const whaleDistDir = path.join(rootDir, 'extensions/chrome/dist-whale');
const releasesWhaleDir = path.join(rootDir, 'releases/whale');

if (fs.existsSync(whaleDistDir)) fs.rmSync(whaleDistDir, { recursive: true, force: true });
if (!fs.existsSync(releasesWhaleDir)) fs.mkdirSync(releasesWhaleDir, { recursive: true });

// 1. 复制 Chrome 的构建产物
const chromeDistDir = path.join(rootDir, 'extensions/chrome/dist');
console.log('📦 正在复制 Chrome 构建产物以生成 Whale 专用版...');
fs.cpSync(chromeDistDir, whaleDistDir, { recursive: true });

// 2. 修改 manifest.json
const manifestPath = path.join(whaleDistDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 🌟 核心修改：强制覆盖 Whale 的版本号，避免小于商店的 1.2.71
const WHALE_VERSION = "1.2.80";
manifest.version = WHALE_VERSION;

// 移除 Whale 不支持的 identity 权限，移除商店专用的 key
if (manifest.permissions) {
    manifest.permissions = manifest.permissions.filter(p => p !== 'identity');
}
delete manifest.key;

// 3. 写入新 manifest
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// 4. 打包成 zip
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
