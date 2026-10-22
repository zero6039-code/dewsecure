#!/bin/bash

EXT_DIR=~/dewsecure/extensions/chrome
cd "$EXT_DIR" || { echo "❌ 找不到目录 $EXT_DIR"; exit 1; }

echo "=========================================="
echo "🚀 DewSecure: 一键切换至 Side Panel 模式"
echo "=========================================="

# 1. 恢复 popup.css 以适应侧边栏（高度撑满，宽度自适应）
echo "🔧 [1/4] 恢复 popup.css 尺寸..."
cd "$EXT_DIR/popup"
sed -i '/^html, body {/,/^}/ {
    s/width: 380px !important;/width: 100%;/
    s/min-height: 550px !important; height: auto !important;/height: 100vh !important;/
}' popup.css

# 2. 修改 background.js 添加 sidePanel 行为
echo "🔧 [2/4] 注入 sidePanel 点击事件..."
cd "$EXT_DIR/src"
if ! grep -q "openPanelOnActionClick" background.js; then
    # 将代码写在文件最前面（安全，不受原有结构影响）
    echo -e "// 启用点击图标打开侧边栏 (Side Panel)\nif (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {\n    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);\n}\n" | cat - background.js > tmp_bg.js && mv tmp_bg.js background.js
    echo "  ✅ background.js 已更新"
else
    echo "  ⏭️ background.js 已有 sidePanel 代码，跳过"
fi

# 3. 使用 node 安全修改 manifest.json
echo "🔧 [3/4] 更新 manifest.json..."
cd "$EXT_DIR"
node -e '
const fs = require("fs");
const path = "./manifest.json";
if (!fs.existsSync(path)) { console.error("❌ 找不到 manifest.json"); process.exit(1); }

let manifest = JSON.parse(fs.readFileSync(path, "utf8"));

// 移除 default_popup
if (manifest.action && manifest.action.default_popup) {
    delete manifest.action.default_popup;
}

// 添加权限
if (!manifest.permissions) manifest.permissions = [];
if (!manifest.permissions.includes("sidePanel")) {
    manifest.permissions.push("sidePanel");
}

// 添加 side_panel 配置
manifest.side_panel = { "default_path": "popup/index.html" };

fs.writeFileSync(path, JSON.stringify(manifest, null, 2));
'
echo "  ✅ manifest.json 已更新"

# 4. 重新打包构建
echo "🔧 [4/4] 重新打包 dist..."
if [ -f "build.js" ]; then
    node build.js
    echo "  ✅ 打包完成"
else
    echo "  ⚠️ 未找到 build.js，请手动将 src/popup 同步至 dist 目录"
fi

echo "=========================================="
echo "🎉 修复完成！"
echo "👉 下一步："
echo "1. 前往 chrome://extensions/"
echo "2. 点击 DewSecure 的“重新加载” (🔄) 按钮"
echo "3. 点击浏览器右上角的扩展图标"
echo "=========================================="
