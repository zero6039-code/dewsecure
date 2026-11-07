// 从 models/training/feature_test_vectors.json 抽样生成 shared/fixtures/adblock-golden.json
// 用法：node scripts/gen_adblock_fixture.mjs
// 输出：稀疏格式（{buckets, structs}），体积可控，Rust 侧易读取

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'models/training/feature_test_vectors.json');
const OUT = path.join(ROOT, 'shared/fixtures/adblock-golden.json');

const STRUCT_OFFSET = 16384;
const TOTAL_DIM = 16418;

const SAMPLING_PLAN = {
  bigsite: 5,
  ip: 3,
  suspicious: 5,
  risky_tld: 3,
  short: 3,
  long: 3,
  random: 15,
};

const BIG_SITES = ['google', 'github', 'youtube', 'amazon', 'wikipedia',
                   'facebook', 'twitter', 'microsoft', 'apple', 'cloudflare', 'reddit'];
const SUSPICIOUS_KWS = ['ad', 'track', 'analytics', 'banner', 'popup',
                        'click', 'pixel', 'doubleclick'];
const RISKY_TLDS = ['tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top', 'work', 'click', 'link'];

function extractHost(key) {
  let lower = key.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    lower = lower.split('//')[1];
  }
  return lower.split('/')[0].split(':')[0];
}

function classifyKey(key) {
  const tags = [];
  const host = extractHost(key);
  const lower = key.toLowerCase();

  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) tags.push('ip');
  if (BIG_SITES.some(s => host.includes(s))) tags.push('bigsite');
  if (SUSPICIOUS_KWS.some(k => lower.includes(k))) tags.push('suspicious');
  if (RISKY_TLDS.some(t => host.endsWith('.' + t))) tags.push('risky_tld');
  if (lower.length < 20) tags.push('short');
  if (lower.length > 100) tags.push('long');
  return tags;
}

function toSparse(dense) {
  const buckets = {};
  const structs = [];
  for (let i = 0; i < STRUCT_OFFSET; i++) {
    if (dense[i] !== 0 && dense[i] !== undefined) buckets[i] = dense[i];
  }
  for (let i = STRUCT_OFFSET; i < dense.length; i++) {
    if (dense[i] !== 0 && dense[i] !== undefined) structs.push([i, dense[i]]);
  }
  return { buckets, structs };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`❌ 找不到源文件：${SRC}`);
    process.exit(1);
  }

  console.log(`📖 读取 ${SRC} ...`);
  const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const entries = Object.entries(raw);
  console.log(`✅ 共 ${entries.length} 条记录`);

  // 打印前 5 个 key 让用户确认格式
  console.log(`\n📋 前 5 个 key 样本：`);
  entries.slice(0, 5).forEach(([k, v]) => {
    console.log(`  ${k}  (dim=${v.length})`);
  });

  // 校验维度
  const badDim = entries.find(([_, v]) => v.length !== TOTAL_DIM);
  if (badDim) {
    console.error(`❌ 维度异常：${badDim[0]} 的维度是 ${badDim[1].length}，期望 ${TOTAL_DIM}`);
    process.exit(1);
  }

  // 分类
  const bucketsByTag = {};
  for (const [key, val] of entries) {
    const tags = classifyKey(key);
    for (const tag of tags) {
      if (!bucketsByTag[tag]) bucketsByTag[tag] = [];
      bucketsByTag[tag].push([key, val]);
    }
  }

  console.log(`\n📊 分类统计：`);
  for (const [tag, list] of Object.entries(bucketsByTag)) {
    console.log(`  ${tag}: ${list.length}`);
  }

  // 抽样
  const selected = new Map();
  for (const [tag, count] of Object.entries(SAMPLING_PLAN)) {
    if (tag === 'random') continue;
    const pool = bucketsByTag[tag] || [];
    const picked = shuffle(pool).slice(0, count);
    for (const [key, val] of picked) selected.set(key, val);
  }

  // 补 random
  const remaining = entries.filter(([k]) => !selected.has(k));
  const randomPicks = shuffle(remaining).slice(0, SAMPLING_PLAN.random);
  for (const [key, val] of randomPicks) selected.set(key, val);

  console.log(`\n🎯 抽样结果：${selected.size} 个 domain`);

  // 转稀疏
  const vectors = {};
  for (const [key, dense] of selected) {
    vectors[key] = toSparse(dense);
  }

  // 输出
  const output = {
    _meta: {
      source: 'models/training/feature_test_vectors.json',
      generated_at: new Date().toISOString(),
      total_dim: TOTAL_DIM,
      struct_offset: STRUCT_OFFSET,
      sample_count: selected.size,
      sampling: 'categorized',
      plan: SAMPLING_PLAN,
    },
    vectors,
  };

  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));
  const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`\n✅ 已生成 ${OUT}（${sizeKB} KB）`);
  console.log(`\n📋 抽到的 domain 列表：`);
  for (const key of selected.keys()) console.log(`  ${key}`);
}

main();
