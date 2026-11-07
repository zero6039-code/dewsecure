import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(__dirname, '../extensions/chrome/rules');
const OUT_FILE = path.join(__dirname, '../shared/adblock/domain-rules.json');

// 源文件到类别的映射
const CATEGORY_MAP = {
  'ads-1a.json': 'ad',
  'ads-1b.json': 'ad',
  'ads-2.json': 'ad',
  'ads-3.json': 'ad',
  'ads-4.json': 'ad',
  'annoyances.json': 'ad',       // 恼人元素归入广告
  'trackers-1a.json': 'tracker',
  'trackers-1b.json': 'tracker',
  'trackers-2a.json': 'tracker',
  'trackers-2b.json': 'tracker',
  'anti-affiliate.json': 'tracker', // 反联盟归入追踪器
};

// 匹配纯净域名规则的严格正则：||domain.com^
// 允许包含字母、数字、点、中划线，至少包含一个点（排除 localhost 等）
const DOMAIN_REGEX = /^\|\|([a-z0-9.-]+\.[a-z0-9.-]+)\^$/i;

function main() {
  const adSet = new Set();
  const trackerSet = new Set();
  let totalRules = 0;
  let extractedRules = 0;

  for (const [file, category] of Object.entries(CATEGORY_MAP)) {
    const filePath = path.join(RULES_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ 找不到 ${file}，跳过`);
      continue;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`📖 ${file}: ${data.length} 条`);
    totalRules += data.length;

    for (const rule of data) {
      if (rule.action && rule.action.type === 'allow') continue;
      
      const urlFilter = rule.condition && rule.condition.urlFilter;
      if (!urlFilter) continue;

      const match = urlFilter.match(DOMAIN_REGEX);
      if (match) {
        const domain = match[1].toLowerCase().trim();
        // 清理可能存在的通配符前缀或后缀
        const cleanDomain = domain.replace(/^\.+|\.+$/g, '');
        
        if (cleanDomain) {
          if (category === 'ad') adSet.add(cleanDomain);
          else trackerSet.add(cleanDomain);
          extractedRules++;
        }
      }
    }
  }

  console.log(`\n📊 原始规则: ${totalRules}`);
  console.log(`📊 成功提取纯域名规则: ${extractedRules} (${((extractedRules/totalRules)*100).toFixed(1)}%)`);

  const adArray = Array.from(adSet).sort();
  const trackerArray = Array.from(trackerSet).sort();

  console.log(`📊 去重后 -> Ad: ${adArray.length} 条, Tracker: ${trackerArray.length} 条`);

  const output = {
    _meta: {
      source: "extensions/chrome/rules/",
      extracted_at: new Date().toISOString(),
      total_rules: totalRules,
      extracted_rules: extractedRules,
      ad_count: adArray.length,
      tracker_count: trackerArray.length,
      note: "仅提取 ||domain^ 形态的纯域名规则，包含强制的 domainType 检查。"
    },
    ad: adArray,
    tracker: trackerArray
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  const sizeMB = (fs.statSync(OUT_FILE).size / (1024 * 1024)).toFixed(2);
  console.log(`\n✅ 已生成 ${OUT_FILE} (${sizeMB} MB)`);
}

main();
