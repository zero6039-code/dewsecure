// 验证 64 位 fnv1a（test_consistency.js 用的）和 32 位变体（ai.js 用的）
// 是否对 fixture 给出相同的 n-gram 桶
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'shared/fixtures/adblock-golden.json');

// 64 位标准 FNV-1a（test_consistency.js 的实现）
function fnv1a64(str) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < str.length; i++) {
        hash ^= BigInt(str.charCodeAt(i));
        hash = BigInt.asUintN(64, hash * prime);
    }
    return hash;
}

// 32 位变体（ai.js 的 fnv1a32）
function fnv1a32(str) {
    let hash = 0x84222325;
    for (let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 0x1b3);
    }
    return hash;
}

// 抽取 3-gram 桶
function getBuckets(domain, hashFn) {
    const s = domain.toLowerCase();
    const buckets = {};
    for (let i = 0; i <= s.length - 3; i++) {
        const gram = s.substring(i, i + 3);
        const h = hashFn(gram);
        const bucket = (typeof h === 'bigint') ? Number(h % 16384n) : (h & 0x3FFF);
        buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    return buckets;
}

function compare(a, b) {
    const keysA = Object.keys(a).map(String);
    const keysB = Object.keys(b).map(String);
    const setA = new Set(keysA);
    const setB = new Set(keysB);
    const onlyA = keysA.filter(k => !setB.has(k));
    const onlyB = keysB.filter(k => !setA.has(k));
    const diffVals = keysA.filter(k => setB.has(k) && a[k] !== b[k]);
    return { onlyA, onlyB, diffVals, match: onlyA.length === 0 && onlyB.length === 0 && diffVals.length === 0 };
}

function main() {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const vectors = fixture.vectors;

    let all64 = 0, all32 = 0, total = 0;

    for (const [domain, expected] of Object.entries(vectors)) {
        total++;
        const expBuckets = expected.buckets;
        
        const b64 = getBuckets(domain, fnv1a64);
        const b32 = getBuckets(domain, fnv1a32);
        
        const c64 = compare(b64, expBuckets);
        const c32 = compare(b32, expBuckets);
        
        if (c64.match) all64++;
        if (c32.match) all32++;
        
        console.log(`\n${domain}  (fixture: ${Object.keys(expBuckets).length} buckets)`);
        console.log(`  64-bit: ${Object.keys(b64).length} buckets ${c64.match ? '✅' : '❌'}`);
        console.log(`  32-bit: ${Object.keys(b32).length} buckets ${c32.match ? '✅' : '❌'}`);
        
        if (!c64.match) {
            console.log(`    64 only: ${c64.onlyA.slice(0, 5)}`);
            console.log(`    fix only: ${c64.onlyB.slice(0, 5)}`);
            console.log(`    diff vals: ${c64.diffVals.slice(0, 5)}`);
        }
        if (!c32.match) {
            console.log(`    32 only: ${c32.onlyA.slice(0, 5)}`);
            console.log(`    fix only: ${c32.onlyB.slice(0, 5)}`);
            console.log(`    diff vals: ${c32.diffVals.slice(0, 5)}`);
        }
    }

    console.log(`\n==========================================`);
    console.log(`64-bit 一致: ${all64}/${total}`);
    console.log(`32-bit 一致: ${all32}/${total}`);
    console.log(`==========================================`);
    console.log('');
    if (all64 === total && all32 === total) {
        console.log(`✅ 两套 hash 都与 fixture 一致。A0-3 可用 32 位实现（性能更好）。`);
    } else if (all64 === total && all32 < total) {
        console.log(`⚠️ 64 位一致，32 位不一致。ai.js 的 32 位实现有 bug！`);
        console.log(`   A0-3 必须先决定：修 ai.js（影响扩展）还是 Rust 用 64 位（性能差）。`);
    } else if (all32 === total && all64 < total) {
        console.log(`⚠️ 32 位一致，64 位不一致。fixture 来源可疑，需查 features.py。`);
    } else {
        console.log(`❌ 两套都对不上 fixture。需要查 Python features.py。`);
    }
}

main();
