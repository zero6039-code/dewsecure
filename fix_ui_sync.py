import os
import time
import shutil
import re

file_path = 'extensions/chrome/popup/modules/ui-render.js'

if not os.path.exists(file_path):
    print(f"❌ 找不到文件: {file_path}")
    exit(1)

backup_path = f"{file_path}.bak_sync_{int(time.time())}"
shutil.copy2(file_path, backup_path)
print(f"✅ 已备份: {backup_path}")

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 精确匹配要替换的单行逻辑
old_logic = "const displayCount = realTodayBlocked > todayLogs.length ? `${todayLogs.length}+` : todayLogs.length;"
new_logic = "const displayCount = realTodayBlocked > 0 ? realTodayBlocked : todayLogs.length;"

if old_logic in content:
    content = content.replace(old_logic, new_logic)
    print("✅ 修复成功: 详情页 Badge 数据已同步为真实总数")
else:
    # 兼容可能的空格差异
    pattern = re.compile(r"const\s+displayCount\s*=\s*realTodayBlocked\s*>\s*todayLogs\.length\s*\?\s*`\$\{todayLogs\.length\}\+`\s*:\s*todayLogs\.length;")
    if pattern.search(content):
        content = pattern.sub(new_logic, content)
        print("✅ 正则替换成功: 详情页 Badge 数据已同步为真实总数")
    else:
        print("❌ 彻底失败: 无法找到对应的逻辑代码，请检查文件内容。")
        exit(1)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("🎉 修复完成！")
