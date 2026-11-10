import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFeatures } from '../src/phishScoutFeatures.js';

// 获取当前文件所在目录的绝对路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 计算 golden_features.json 的绝对路径 (测试脚本在 extensions/chrome/tests，往上 3 级就是根目录)
const goldenPath = path.resolve(__dirname, '../../../models/training/golden_features.json');

if (!fs.existsSync(goldenPath)) {
    console.error(`❌ 找不到基准文件: ${goldenPath}`);
    console.error('请先在 models/training 目录下运行 python3 make_golden.py');
    process.exit(1);
}

const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
let bad = 0;

for (const { url, feats } of golden) {
    const j = extractFeatures(url);
    let rowBad = false;
    for (let i = 0; i < 579; i++) {
        const diff = Math.abs(j[i] - feats[i]);
        const tol = 1e-4 * Math.max(1, Math.abs(feats[i]));
        if (diff > tol) {
            if (!rowBad) console.error(`\n❌ DIFF URL: ${url}`);
            console.error(`   特征 #${i}: JS=${j[i]}, Py=${feats[i]}, 差值=${diff}`);
            rowBad = true;
            bad++;
        }
    }
}

if (bad > 0) {
    console.error(`\n❌ 测试失败: 发现 ${bad} 处特征不一致！`);
    process.exit(1);
} else {
    console.log(`✅ 测试通过: ${golden.length} 条样本的 579 维特征完全一致！`);
}
