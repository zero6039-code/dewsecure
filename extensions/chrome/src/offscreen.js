/**
 * DewSecure Offscreen Document
 *
 * 使用 onnxruntime-web/wasm 子入口，避免加载 JSEP 变体
 */

import * as ort from 'onnxruntime-web/wasm';

console.log('🔧 Offscreen Document 启动');
console.log('   ort 类型:', typeof ort);
console.log('   ort.env:', typeof ort?.env);

// 配置 ONNX Runtime
try {
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('wasm/');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    console.log('   wasmPaths:', ort.env.wasm.wasmPaths);
} catch (e) {
    console.error('❌ ort.env 配置失败:', e);
}

let classifierSession = null;
let initPromise = null;

async function initModel() {
    if (classifierSession) return classifierSession;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const modelUrl = chrome.runtime.getURL('models/classifier_int8.onnx');
            console.log('📥 开始加载模型:', modelUrl);

            // 验证模型文件可访问
            const headResponse = await fetch(modelUrl, { method: 'HEAD' });
            console.log('   模型文件 HTTP 状态:', headResponse.status);

            classifierSession = await ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm'],
            });
            console.log('✅ Offscreen: AI 分类器已加载');
            return classifierSession;
        } catch (e) {
            console.error('❌ Offscreen: 模型加载失败:', e);
            console.error('   错误堆栈:', e.stack);
            initPromise = null;
            return null;
        }
    })();

    return initPromise;
}

async function classify(features) {
    const session = await initModel();
    if (!session) return { error: '模型未加载' };

    try {
        const tensor = new ort.Tensor(
            'float32',
            new Float32Array(features),
            [1, features.length]
        );
        const inputName = session.inputNames[0];
        const outputName = session.outputNames[0];
        const result = await session.run({ [inputName]: tensor });
        const prob = result[outputName].data[0];
        return { prob };
    } catch (e) {
        console.error('❌ 推理失败:', e);
        return { error: String(e) };
    }
}

// ============ 与 Service Worker 通信 ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== 'offscreen') return false;

    if (message.type === 'INIT') {
        initModel().then((s) => sendResponse({ ok: !!s, detail: s ? 'loaded' : 'failed' }));
        return true;
    }

    if (message.type === 'CLASSIFY') {
        classify(message.features).then(sendResponse);
        return true;
    }

    if (message.type === 'PING') {
        sendResponse({ ok: true, ready: !!classifierSession });
        return true;
    }

    return false;
});

// 启动时预加载模型
initModel().then((s) => {
    console.log('预加载结果:', s ? '✅ 成功' : '❌ 失败');
});
