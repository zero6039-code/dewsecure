// ==========================================
// 🌲 纯 JS 树模型推理引擎 (GBDT / LightGBM)
// 完美兼容 ONNX 的 base_values 和树分支容错
// ==========================================

const MAX_DEPTH = 64;

export function loadModel(m) {
    return {
        n: m.nFeatures,
        roots: Int32Array.from(m.roots),
        feat: Int32Array.from(m.feat),
        thr: Float64Array.from(m.thr),
        left: Int32Array.from(m.left),
        right: Int32Array.from(m.right),
        defLeft: Uint8Array.from(m.defLeft),
        val: Float64Array.from(m.val),
        baseValue: m.baseValue ?? 0,
        a: m.platt?.a ?? 1.0,
        b: m.platt?.b ?? 0.0
    };
}

// 🛡️ A-4 修复：校验模型结构，防止恶意/损坏的模型导致越界或死循环
export function validateTreeModel(m, nFeatures = 579) {
    const arrs = [m.roots, m.feat, m.thr, m.left, m.right, m.defLeft, m.val];
    if (m.nFeatures !== nFeatures || !arrs.every(Array.isArray)) return false;
    
    const N = m.feat.length;
    if (N === 0 || N > 2_000_000 || m.roots.length > 5000) return false;
    if (![m.thr, m.left, m.right, m.defLeft, m.val].every(a => a.length === N)) return false;
    
    for (let i = 0; i < N; i++) {
        const f = m.feat[i];
        if (!Number.isInteger(f) || f >= nFeatures) return false;
        if (f >= 0) {
            const l = m.left[i], r = m.right[i];
            if (!Number.isInteger(l) || !Number.isInteger(r) || l < 0 || r < 0 || l >= N || r >= N) return false;
            if (!Number.isFinite(m.thr[i])) return false;
        } else if (!Number.isFinite(m.val[i])) return false;
    }
    return m.roots.every(r => Number.isInteger(r) && r >= 0 && r < N);
}

export function predict(M, x) {
    let raw = M.baseValue;
    for (let t = 0; t < M.roots.length; t++) {
        let i = M.roots[t];
        for (let steps = 0; M.feat[i] >= 0; steps++) {
            // 🛡️ A-4 修复：强行阻断死循环
            if (steps > MAX_DEPTH) return NaN; 
            
            const v = x[M.feat[i]];
            let goLeft;
            if (v === undefined || Number.isNaN(v)) {
                goLeft = M.defLeft[i] === 1;
            } else {
                goLeft = v <= M.thr[i];
            }
            i = goLeft ? M.left[i] : M.right[i];
        }
        raw += M.val[i];
    }
    return 1 / (1 + Math.exp(-(M.a * raw + M.b)));
}
