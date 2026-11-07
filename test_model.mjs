import fs from 'fs';

const data = JSON.parse(fs.readFileSync('./extensions/chrome/src/phishscout_local.json', 'utf8'));

// 模拟加载模型
const M = {
    n: data.nFeatures,
    roots: Int32Array.from(data.roots),
    feat: Int32Array.from(data.feat),
    thr: Float64Array.from(data.thr),
    left: Int32Array.from(data.left),
    right: Int32Array.from(data.right),
    defLeft: Uint8Array.from(data.defLeft),
    val: Float64Array.from(data.val),
    a: data.platt.a,
    b: data.platt.b
};

// 模拟特征 (百度)
const x = new Float32Array(579);
x[15] = 1; // path_length

let raw = 0;
let leafHits = 0;
for (let t = 0; t < M.roots.length; t++) {
    let i = M.roots[t];
    let depth = 0;
    while (M.feat[i] >= 0) {
        depth++;
        const v = x[M.feat[i]];
        let goLeft;
        if (Number.isNaN(v) || v === undefined) {
            goLeft = M.defLeft[i] === 1;
        } else {
            goLeft = v <= M.thr[i];
        }
        i = goLeft ? M.left[i] : M.right[i];
        if (depth > 15) {
            console.log(`树 ${t} 超深了！陷入了死循环，i=${i}`);
            break;
        }
    }
    leafHits++;
    raw += M.val[i];
}
console.log(`Node 环境计算出的原始得分: ${raw}`);
console.log(`叶子节点命中数量: ${leafHits} (总共 ${M.roots.length} 棵树)`);
