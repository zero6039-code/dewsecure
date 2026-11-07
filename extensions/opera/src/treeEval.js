// ==========================================
// 🌲 纯 JS 树模型推理引擎 (GBDT / LightGBM)
// 无 WASM，无第三方依赖
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
        a: m.platt.a,
        b: m.platt.b
    };
}

export function predict(M, x /* 长度 M.n 的 Float32Array */) {
    let raw = 0;
    for (let t = 0; t < M.roots.length; t++) {
        let i = M.roots[t];
        while (M.feat[i] >= 0) {
            const v = x[M.feat[i]];
            // 判断是否走左子树 (如果是 NaN 则看默认方向)
            const goLeft = Number.isNaN(v) ? M.defLeft[i] === 1 : v <= M.thr[i];
            i = goLeft ? M.left[i] : M.right[i];
        }
        raw += M.val[i];
    }
    // 通过 Sigmoid 函数输出 0~1 的概率
    return 1 / (1 + Math.exp(-(M.a * raw + M.b)));
}
