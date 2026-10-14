/**
 * 拆分规则文件，避免超过 Chrome DNR 单文件 30,000 条限制
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(__dirname, '..', 'rules');
const MAX_PER_FILE = 30000;

function splitRulesFile(baseName) {
    const inputPath = path.join(RULES_DIR, `${baseName}.json`);
    if (!fs.existsSync(inputPath)) {
        console.log(`⚠️ 跳过 ${baseName}.json（不存在）`);
        return [];
    }

    const rules = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

    // ✅ 先读入内容到内存，再删除原文件
    fs.unlinkSync(inputPath);
    console.log(`  🗑️ 已读取 ${baseName}.json，删除原文件`);

    const chunks = [];

    for (let i = 0; i < rules.length; i += MAX_PER_FILE) {
        const chunk = rules.slice(i, i + MAX_PER_FILE);
        chunk.forEach((rule, idx) => {
            rule.id = idx + 1;
        });

        // ✅ 第一个 chunk 命名为 ads-1.json，避免与原名冲突
        const suffix = chunks.length + 1;
        const outputName = `${baseName}-${suffix}.json`;
        const outputPath = path.join(RULES_DIR, outputName);

        fs.writeFileSync(outputPath, JSON.stringify(chunk, null, 2));
        const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
        console.log(`  ✅ ${outputName}: ${chunk.length} 条 (${sizeMB} MB)`);

        chunks.push(outputName);
    }

    return chunks;
}

function main() {
    console.log('🔧 拆分规则文件\n');
    const allChunks = [];

    for (const base of ['ads', 'trackers']) {
        console.log(`📦 处理 ${base}...`);
        allChunks.push(...splitRulesFile(base));
        console.log('');
    }

    console.log(`✅ 拆分完成，共 ${allChunks.length} 个文件:`);
    let totalRules = 0;
    allChunks.forEach((name) => {
        const filePath = path.join(RULES_DIR, name);
        const rules = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        totalRules += rules.length;
        const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
        console.log(`   - ${name}: ${rules.length} 条 (${sizeMB} MB)`);
    });
    console.log(`\n📊 总规则数: ${totalRules}`);
}

main();
