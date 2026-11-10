const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const operaDistDir = path.join(rootDir, 'extensions/opera/dist-opera');
const releasesOperaDir = path.join(rootDir, 'releases/opera');

if (fs.existsSync(operaDistDir)) fs.rmSync(operaDistDir, { recursive: true, force: true });
if (!fs.existsSync(releasesOperaDir)) fs.mkdirSync(releasesOperaDir, { recursive: true });

// 1. 复制 Opera 的构建产物
const originalDistDir = path.join(rootDir, 'extensions/opera/dist');
console.log('📦 正在复制 Opera 构建产物以生成独立版本...');
fs.cpSync(originalDistDir, operaDistDir, { recursive: true });

// 2. 修改 manifest.json
const manifestPath = path.join(operaDistDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 🌟 强制覆盖版本号为 1.2.80 以避开商店限制
const OPERA_VERSION = "1.2.80";
manifest.version = OPERA_VERSION;

// 移除可能冲突的 key
delete manifest.key;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// 3. 打包成 zip
const zipName = `opera-v${OPERA_VERSION}.zip`;
const zipPath = path.join(releasesOperaDir, zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

try {
    // 注意：必须在 dist-opera 目录下执行 zip，保证 manifest.json 在 zip 根目录
    execSync(`cd "${operaDistDir}" && zip -r "${zipPath}" ./*`, { stdio: 'inherit' });
    console.log(`✅ Opera 专用包生成成功: ${zipPath}`);
} catch (e) {
    console.log(`⚠️ 打包 zip 失败，请检查系统是否安装了 zip 命令。`);
}
