import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('🦊 开始构建 Firefox 版本 (无混淆，仅压缩)...');

// 1. 生成未混淆的 Chrome 产物 (dist目录)
console.log('⏳ 正在生成未混淆的源码...');
execSync('node build.js --no-obfuscate', { stdio: 'inherit' });

const firefoxDir = '../firefox';
const firefoxDist = path.join(firefoxDir, 'dist');

// 清理旧的 Firefox 目录
if (fs.existsSync(firefoxDist)) {
    fs.rmSync(firefoxDist, { recursive: true, force: true });
}
fs.mkdirSync(firefoxDist, { recursive: true });

// 2. 生成 Firefox 专属的 manifest.json
const chromeManifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
delete chromeManifest.key;
delete chromeManifest.side_panel;
delete chromeManifest.background.service_worker;
delete chromeManifest.background.type;
delete chromeManifest.externally_connectable;
if (chromeManifest.action) { delete chromeManifest.action.default_popup; }

chromeManifest.permissions = chromeManifest.permissions.filter(p => p !== 'offscreen' && p !== 'sidePanel');

chromeManifest.background.scripts = ["src/background.js"];
chromeManifest.sidebar_action = {
    default_panel: "popup/index.html",
    default_title: "DewSecure",
    default_icon: "icons/icon-48.png"
};
chromeManifest.browser_specific_settings = {
    gecko: {
        id: "dewsecure@dewsecure.com",
        strict_min_version: "113.0",
        data_collection_permissions: { required: ["none"] }
    }
};

fs.writeFileSync(path.join(firefoxDist, 'manifest.json'), JSON.stringify(chromeManifest, null, 2));
console.log('✅ 已生成 Firefox 专属 manifest.json');

// 3. 拷贝未混淆的构建产物
const chromeDist = './dist';
function copyDir(src, dest, skip) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (skip.includes(entry.name)) continue;
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath, skip);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
copyDir(chromeDist, firefoxDist, ['manifest.json']);
console.log('✅ 已拷贝未混淆构建产物至 Firefox 目录');

// 4. 打包成 zip 文件
const version = chromeManifest.version;
const zipName = `../releases/chrome/dewsecure-firefox-v${version}.zip`;
if (!fs.existsSync('../releases/chrome')) fs.mkdirSync('../releases/chrome', { recursive: true });
if (fs.existsSync(zipName)) fs.unlinkSync(zipName);

try {
    execSync(`cd ../firefox/dist && zip -r ../../../releases/chrome/dewsecure-firefox-v${version}.zip .`);
    console.log(`🎉 Firefox 包已生成: ${zipName}`);
} catch (e) {
    console.error('打包 zip 失败:', e.message);
}

// 5. 恢复 Chrome 的混淆构建产物 (重要：防止污染 Chrome 包)
console.log('⏳ 正在恢复 Chrome 混淆构建产物...');
execSync('node build.js', { stdio: 'inherit' });
console.log('✅ Chrome 混淆包已恢复，双端构建完美隔离！');
