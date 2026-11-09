// ==========================================
// 🧠 PhishScout AI 模型下载与热更新管理器
// 支持 R2 + Worker 鉴权动态拉取，与本地回退兜底
// ==========================================

import { validateTreeModel } from '../treeEval.js';
import { due } from './alarmHelper.js';

const WORKER_URL = 'https://api.dewsecure.com/v1/model/phishscout';

export async function checkAndUpdatePhishModel({ force = false } = {}) {
    try {
        // 1. 节流控制：如果非强制刷新，检查距离上次检查是否已满 6 小时
        if (!force && !(await due('phish_model_last_check', 6 * 3600e3))) {
            return false; // 还未到 6 小时，静默跳过
        }

        // 2. 获取当前用户状态与上次的 ETag
        const { dewsecure_user, phish_model_etag } = await chrome.storage.local.get([
            'dewsecure_user',
            'phish_model_etag'
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

        // 3. 携带 If-None-Match 启用缓存协商
        if (phish_model_etag) {
            headers['If-None-Match'] = phish_model_etag;
        }

        const res = await fetch(WORKER_URL, {
            method: 'GET',
            headers: headers,
            cache: 'no-cache'
        });

        // 4. 处理 304 响应（模型未改变），直接返回
        if (res.status === 304) {
            console.log('✅ [AI] 模型未更新（304），跳过解析。');
            return false;
        }

        if (!res.ok) {
            throw new Error(`Worker returned HTTP ${res.status}`);
        }

        const newModel = await res.json();

        // 5. 核心安全校验
        if (newModel && validateTreeModel(newModel)) {
            const newEtag = res.headers.get('ETag');
            await chrome.storage.local.set({
                phishscout_model_data: newModel,
                ...(newEtag ? { phish_model_etag: newEtag } : {})
            });
            console.log('🔄 [AI] PhishScout 模型热更新成功');

            // 通知运行中的模块重新加载模型
            chrome.runtime.sendMessage({ type: 'PHISH_MODEL_UPDATED' }).catch(() => {});
            return true;
        } else {
            throw new Error('Model schema validation failed');
        }
    } catch (e) {
        console.warn('⚠️ [AI] 模型热更新拉取失败，静默使用内置基础模型:', e.message);
        return false;
    }
}

export async function getPhishModelData() {
    // 优先从本地缓存读取
    const { phishscout_model_data } = await chrome.storage.local.get('phishscout_model_data');
    if (phishscout_model_data) return phishscout_model_data;

    // 如果本地没有热更缓存，加载源码打包的 JSON
    const module = await import('../phishscout_local.json');
    return module.default || module;
}
