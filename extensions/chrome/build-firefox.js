import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('🦊 开始构建 Firefox 版本...');

const firefoxDir = '../firefox';
const firefoxDist = path.join(firefoxDir, 'dist');

if (fs.existsSync(firefoxDist)) {
    fs.rmSync(firefoxDist, { recursive: true, force: true });
}
fs.mkdirSync(firefoxDist, { recursive: true });

const chromeManifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

// 🌟 清除所有 Firefox 不兼容的配置
delete chromeManifest.key;
delete chromeManifest.side_panel;
delete chromeManifest.background.service_worker;
delete chromeManifest.background.type;
delete chromeManifest.externally_connectable; // 移除
if (chromeManifest.action) { delete chromeManifest.action.default_popup; }

// 过滤掉 offscreen 和 sidePanel 权限
chromeManifest.permissions = chromeManifest.permissions.filter(p => p !== 'offscreen' && p !== 'sidePanel');

// 添加 Firefox 专属配置
chromeManifest.background.scripts = ["src/background.js"];
chromeManifest.sidebar_action = {
    default_panel: "popup/index.html",
    default_title: "DewSecure",
    default_icon: "icons/icon-48.png"
};
chromeManifest.browser_specific_settings = {
    gecko: {
        id: "dewsecure@dewsecure.com",
        strict_min_version: "109.0"
    }
};

fs.writeFileSync(path.join(firefoxDist, 'manifest.json'), JSON.stringify(chromeManifest, null, 2));
console.log('✅ 已生成 Firefox 专属 manifest.json');

const chromeDist = './dist';
const skipFiles = ['manifest.json'];

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

copyDir(chromeDist, firefoxDist, skipFiles);
console.log('✅ 已拷贝构建产物至 Firefox 目录');

const zipName = `../releases/chrome/dewsecure-firefox-v${chromeManifest.version}.zip`;
if (!fs.existsSync('../releases/chrome')) fs.mkdirSync('../releases/chrome', { recursive: true });
if (fs.existsSync(zipName)) fs.unlinkSync(zipName);

try {
    execSync(`cd ../firefox/dist && zip -r ../../../releases/chrome/dewsecure-firefox-v${chromeManifest.version}.zip .`);
    console.log(`🎉 Firefox 包已生成: ${zipName}`);
} catch (e) {
    console.error('打包 zip 失败:', e.message);
}
