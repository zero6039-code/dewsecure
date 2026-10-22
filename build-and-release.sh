#!/bin/bash
echo "📦 开始本地打包流程..."
cd ~/dewsecure/extensions/chrome
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 构建失败，请检查上方报错！"
    exit 1
fi

echo "✅ 构建成功，正在打包 zip..."
VERSION=$(node -p "require('./manifest.json').version")
mkdir -p ~/dewsecure/releases/chrome
cd ~/dewsecure/extensions/chrome/dist
zip -r ~/dewsecure/releases/chrome/chrome-v$VERSION.zip . > /dev/null

echo "🎉 打包完成！文件位置：~/dewsecure/releases/chrome/chrome-v$VERSION.zip"

# 自动同步到 Git
cd ~/dewsecure
git add releases/chrome/chrome-v$VERSION.zip
git commit -m "chore: 本地打包发布 chrome-v$VERSION.zip"
git push origin main
echo "🚀 已自动推送到 GitHub releases/chrome/ 目录！"
