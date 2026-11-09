import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

console.log('🦊 开始构建 Firefox 版本 (最原始纯净版)...');
execSync('node build.js --no-obfuscate', { stdio: 'inherit' });

const firefoxDir = '../firefox';
const firefoxDist = path.join(firefoxDir, 'dist');

if (fs.existsSync(firefoxDist)) fs.rmSync(firefoxDist, { recursive: true, force: true });
fs.mkdirSync(firefoxDist, { recursive: true });

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
    gecko: { id: "dewsecure@dewsecure.com", strict_min_version: "113.0", data_collection_permissions: { required: ["none"] } }
};

if (chromeManifest.web_accessible_resources) {
    chromeManifest.web_accessible_resources.forEach(res => delete res.use_dynamic_url);
}

fs.writeFileSync(path.join(firefoxDist, 'manifest.json'), JSON.stringify(chromeManifest, null, 2));

function copyDir(src, dest, skip) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (let entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (skip.includes(entry.name)) continue;
        if (entry.isDirectory()) copyDir(srcPath, destPath, skip);
        else fs.copyFileSync(srcPath, destPath);
    }
}
copyDir('./dist', firefoxDist, ['manifest.json']);

// 只做一件事：清理 Firefox 报错的 webtransport 和 webbundle，其他的原样保留
const rulesDir = path.join(firefoxDist, 'rules');
if (fs.existsSync(rulesDir)) {
    const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json'));
    for (const file of ruleFiles) {
        const filePath = path.join(rulesDir, file);
        let fileContent = fs.readFileSync(filePath, 'utf8');
        fileContent = fileContent.replace(/"webtransport"\s*,?/g, '').replace(/"webbundle"\s*,?/g, '');
        fileContent = fileContent.replace(/,\s*]/g, ']');
        fs.writeFileSync(filePath, fileContent);
    }
}

execSync('node build.js', { stdio: 'inherit' });
console.log('✅ Firefox 纯净构建完成！');
