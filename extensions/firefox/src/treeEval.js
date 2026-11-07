// ==========================================
// 🌲 纯 JS 树模型推理引擎 (GBDT / LightGBM)
// 完美兼容 ONNX 的 base_values 和树分支容错
// ==========================================

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

export function predict(M, x) {
    let raw = M.baseValue;
    for (let t = 0; t < M.roots.length; t++) {
        let i = M.roots[t];
        while (M.feat[i] >= 0) {
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
