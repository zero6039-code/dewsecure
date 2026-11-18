import os
import time
import shutil

file_path = 'extensions/chrome/src/background/stats.js'

if not os.path.exists(file_path):
    print(f"❌ 找不到文件: {file_path}，请确保在项目根目录执行")
    exit(1)

# 1. 自动备份
backup_path = f"{file_path}.bak_fix_{int(time.time())}"
shutil.copy2(file_path, backup_path)
print(f"✅ 已备份原文件到: {backup_path}")

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 2. 执行替换逻辑

# 修复点 1: webRequest 的 recordBlock 传参
old_1 = "recordBlock(host + '/webRequest-dnr', 'dnr-intercept');"
new_1 = "recordBlock(details.url, 'dnr-intercept');"
if old_1 in content:
    content = content.replace(old_1, new_1)
    print("✅ 修复点 1: 统一 webRequest URL 格式")
else:
    print("⚠️ 警告: 未找到修复点 1，可能已被修改")

# 修复点 2: onRuleMatchedDebug 的 recordBlock 传参
old_2 = "await recordBlock(new URL(info.request.url).hostname + '/dnr-debug', 'dnr-debug');"
new_2 = "await recordBlock(info.request.url, 'dnr-debug');"
if old_2 in content:
    content = content.replace(old_2, new_2)
    print("✅ 修复点 2: 统一 onRuleMatchedDebug URL 格式")
else:
    print("⚠️ 警告: 未找到修复点 2，可能已被修改")

# 修复点 3: getMatchedRules 同步写入 memoryLogs 并去重
old_3 = """if (matched?.rulesMatchedInfo?.length > 0) {
                    const count = matched.rulesMatchedInfo.length;
                    await ensureLoaded();
                    memoryStats.totalBlocked += count;
                    memoryStats.todayBlocked += count;
                    scheduleSave();
                        addSavings(count).catch(e => console.warn('Savings error:', e));
                }"""

new_3 = """if (matched?.rulesMatchedInfo?.length > 0) {
                    await ensureLoaded();
                    const todayStr = new Date().toDateString();
                    
                    // 过滤掉已经被 webRequest 记录过的规则，防止重复统计
                    const newRulesMatched = matched.rulesMatchedInfo.filter(info => {
                        const url = info.request?.url;
                        if (!url || url.includes('dewsecure.com')) return false;
                        // 检查 memoryLogs 中最近是否已有相同的 URL 记录
                        return !memoryLogs.some(l => l.url === url && l.ts >= lastFetchTime);
                    });

                    if (newRulesMatched.length > 0) {
                        memoryStats.totalBlocked += newRulesMatched.length;
                        memoryStats.todayBlocked += newRulesMatched.length;

                        // 将 getMatchedRules 抓到的新记录同步到日志
                        newRulesMatched.forEach(info => {
                            const url = info.request.url;
                            let domain = '未知';
                            try {
                                domain = new URL(url).hostname;
                            } catch (e) {}
                            memoryLogs.push({ domain, url, type: 'dnr-intercept', date: todayStr, ts: Date.now() });
                        });

                        if (memoryLogs.length > 1000) {
                            memoryLogs.splice(0, memoryLogs.length - 1000);
                        }

                        scheduleSave();
                        addSavings(newRulesMatched.length).catch(e => console.warn('Savings error:', e));
                    }
                }"""

if old_3 in content:
    content = content.replace(old_3, new_3)
    print("✅ 修复点 3: 补全 getMatchedRules 的日志记录与去重逻辑")
else:
    print("❌ 错误: 未找到修复点 3。由于缩进可能不完全一致，请手动检查，或联系我提供当前文件片段。")
    exit(1)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("🎉 全部修复完成！代码已更新。")
