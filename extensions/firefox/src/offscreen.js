/**
 * DewSecure Offscreen Document
 *
 * 使用 onnxruntime-web/wasm 子入口，避免加载 JSEP 变体
 */

import * as ort from 'onnxruntime-web/wasm';
import { getCachedModel } from './modelManager.js';

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
            let modelData = null;
            let modelSource = 'unknown';

            // 1. 优先从缓存加载
            try {
                const cached = await getCachedModel();
                if (cached && cached.buffer) {
                    modelData = new Uint8Array(cached.buffer);
                    modelSource = 'cache';
                    console.log('📥 从缓存加载模型:', cached.meta?.trainedAt);
                }
            } catch (e) {
                console.warn('读取缓存失败:', e);
            }

            // 2. 核心修复：因为商业策略决定包内不含默认模型，所以移除 fetch 本地文件的逻辑
            if (!modelData) {
                console.log('⏳ 本地无缓存模型，等待云端授权下发 (仅限 PRO)。');
                throw new Error('MODEL_NOT_READY'); // 抛出一个特定错误
            }

            console.log('   模型来源:', modelSource, `(${(modelData.byteLength / 1024).toFixed(1)} KB)`);

            classifierSession = await ort.InferenceSession.create(modelData, {
                executionProviders: ['wasm'],
            });
            console.log('✅ Offscreen: AI 分类器已加载');
            return classifierSession;
        } catch (e) {
            if (e.message === 'MODEL_NOT_READY') {
                // 静默处理，不打印任何 error 或 warn
                console.log('🛡️ [Offscreen] 静默等待云端模型下载...');
            } else {
                console.warn('⚠️ Offscreen: 模型加载失败（将在后台自动重试）:', e.message);
            }
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
        const probs = Array.from(result[outputName].data);  // [p_normal, p_ad, p_tracker]
        return { probs };
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
