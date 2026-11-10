// ==========================================
// 🧠 PhishScout AI 模型下载与热更新管理器
// 支持 R2 + Worker 鉴权动态拉取，与本地回退兜底
// ==========================================

import { validateTreeModel } from '../treeEval.js';
import { due } from './alarmHelper.js';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// 🔒 必须注入 SHA-512 引擎
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// 🔒 复用与 modelManager.js 相同的 Ed25519 公钥
const ED25519_PUBLIC_KEY_HEX = '259eab8b493845eb78e345a139584c6812272d7183c7da29f774dea2d443fe77';
const WORKER_URL = 'https://api.dewsecure.com/v1/model/phishscout';

export async function checkAndUpdatePhishModel({ force = false } = {}) {
    try {
        // 1. 节流控制
        if (!force && !(await due('phish_model_last_check', 6 * 3600e3))) {
            return false;
        }

        const { dewsecure_user, phish_model_etag } = await chrome.storage.local.get([
            'dewsecure_user', 'phish_model_etag'
        ]);

        if (!dewsecure_user || !dewsecure_user.token) {
            console.log('⚠️ [AI] 用户未登录，使用内置基础模型。');
            return false;
        }

        console.log('📡 [AI] 正在检查模型更新...');
        const headers = {
            'Authorization': `Bearer ${dewsecure_user.token}`,
            'X-Device-Id': dewsecure_user.deviceId || 'unknown'
        };

        if (phish_model_etag) headers['If-None-Match'] = phish_model_etag;

        const res = await fetch(WORKER_URL, { method: 'GET', headers, cache: 'no-cache' });

        if (res.status === 304) {
            console.log('✅ [AI] 模型未更新（304），跳过解析。');
            return false;
        }
        if (!res.ok) throw new Error(`Worker returned HTTP ${res.status}`);

        // 2. 获取签名安全头
        const remoteVersion = res.headers.get('X-Model-Version') || 'unknown';
        const remoteSha256 = res.headers.get('X-Model-Sha256');
        const signatureB64 = res.headers.get('X-Model-Signature');

        if (!remoteSha256 || !signatureB64) {
            throw new Error('缺少安全签名头 (X-Model-Sha256 / X-Model-Signature)');
        }

        // 3. 读取原始文本并计算 SHA-256
        const modelText = await res.text();
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(modelText));
        const actualHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

        if (actualHash !== remoteSha256) {
            throw new Error('模型 SHA-256 校验失败！(防中间人篡改)');
        }

        // 4. Ed25519 签名校验
        const msgStr = `${remoteVersion}:${remoteSha256}`;
        const msgBytes = new TextEncoder().encode(msgStr);
        const sigBytes = Uint8Array.from(atob(signatureB64.trim()), c => c.charCodeAt(0));
        const pubKeyBytes = new Uint8Array(ED25519_PUBLIC_KEY_HEX.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

        const isValid = await ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
        if (!isValid) {
            throw new Error('Ed25519 签名校验失败！(拒绝恶意模型更新)');
        }
        console.log('✅ [AI] 模型签名校验通过！');

        // 5. 解析并校验结构
        const newModel = JSON.parse(modelText);
        if (!newModel || !validateTreeModel(newModel)) {
            throw new Error('Model schema validation failed');
        }

        // 6. 落盘缓存
        const newEtag = res.headers.get('ETag');
        await chrome.storage.local.set({
            phishscout_model_data: newModel,
            ...(newEtag ? { phish_model_etag: newEtag } : {})
        });
        console.log('🔄 [AI] PhishScout 模型热更新成功');
        chrome.runtime.sendMessage({ type: 'PHISH_MODEL_UPDATED' }).catch(() => {});
        return true;

    } catch (e) {
        console.warn('⚠️ [AI] 模型热更新拉取/校验失败，静默使用内置基础模型:', e.message);
        return false;
    }
}

export async function getPhishModelData() {
    const { phishscout_model_data } = await chrome.storage.local.get('phishscout_model_data');
    if (phishscout_model_data) return phishscout_model_data;
    const module = await import('../phishscout_local.json');
    return module.default || module;
}
