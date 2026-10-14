/**
 * 从 EasyList 自动转换为 Chrome DNR 格式
 * 基于 @adguard/dnr-converter v2.0.0 API
 */

import { Filter, FilterConverter } from '@adguard/dnr-converter';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(__dirname, '..', 'rules');

const SOURCES = {
    ads: [
        'https://easylist.to/easylist/easylist.txt',
    ],
    trackers: [
        'https://easylist.to/easylist/easyprivacy.txt',
    ],
};

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败: ${url} (${response.status})`);
    return response.text();
}

async function convertCategory(name, urls) {
    console.log(`\n📦 处理 ${name}...`);
    let allRules = [];
    let totalErrors = 0;
    let totalLimitations = 0;

    const converter = new FilterConverter();

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
            console.log(`  下载: ${url}`);
            const text = await fetchText(url);
            console.log(`    原始内容: ${text.length} 字符`);

            // 每个 Filter 需要一个唯一的数字 id
            const filter = new Filter(i + 1, text);

            // convert() 返回 ConversionResult[]，每个包含 ruleset + errors + limitations
            const results = await converter.convert([filter]);

            for (const result of results) {
                if (result.ruleset && Array.isArray(result.ruleset.declarativeRules)) {
                    allRules.push(...result.ruleset.declarativeRules);
                    console.log(`    ruleset id=${result.ruleset.id}: ${result.ruleset.declarativeRules.length} 条`);
                }
                if (result.errors && result.errors.length > 0) {
                    totalErrors += result.errors.length;
                }
                if (result.limitations && result.limitations.length > 0) {
                    totalLimitations += result.limitations.length;
                }
            }
        } catch (e) {
            console.error(`  ❌ ${url} 处理失败:`, e.message);
        }
    }

    console.log(`    ✅ 转换完成: ${allRules.length} 条规则`);
    if (totalErrors > 0) console.log(`    ⚠️ 转换错误: ${totalErrors} 条`);
    if (totalLimitations > 0) console.log(`    ⚠️ 未转换: ${totalLimitations} 条`);

    // 去重 + 分配唯一 ID
    const seen = new Set();
    const unique = [];
    for (const rule of allRules) {
        const key = JSON.stringify(rule.condition);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(rule);
        }
    }

    // 重新分配唯一 ID（避免冲突）
    // 用数字哈希生成相对唯一的 ID
    for (let i = 0; i < unique.length; i++) {
        unique[i].id = i + 1;
        unique[i].priority = unique[i].priority || 1;
    }

    const outputPath = path.join(RULES_DIR, `${name}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(unique, null, 2));
    console.log(`  💾 输出: ${outputPath} (${unique.length} 条, ${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
    return unique.length;
}

async function main() {
    console.log('🚀 EasyList → DNR 转换开始');

    const stats = {};
    for (const [name, urls] of Object.entries(SOURCES)) {
        stats[name] = await convertCategory(name, urls);
    }

    console.log('\n📊 转换完成:');
    for (const [name, count] of Object.entries(stats)) {
        console.log(`  ${name}: ${count} 条`);
    }
    console.log(`  总计: ${Object.values(stats).reduce((a, b) => a + b, 0)} 条`);
}

main().catch((e) => {
    console.error('❌ 转换失败:', e);
    process.exit(1);
});
