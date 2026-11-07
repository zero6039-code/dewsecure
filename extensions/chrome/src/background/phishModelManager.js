// ==========================================
// 🧠 PhishScout AI 模型下载与热更新管理器
// 支持 R2 + Worker 鉴权动态拉取，与本地回退兜底
// ==========================================

export async function checkAndUpdatePhishModel() {
    try {
        // 1. 获取当前用户状态，尝试鉴权
        const { dewsecure_user } = await chrome.storage.local.get('dewsecure_user');
        
        // 如果用户未登录，直接跳过网络请求，使用内置基础模型即可
        if (!dewsecure_user || !dewsecure_user.token) {
            console.log('⚠️ [AI] 用户未登录，使用内置基础模型。');
            return false;
        }

        // 2. 请求你包装了 Cloudflare Worker 的专属域名
        const WORKER_URL = 'https://api.dewsecure.com/v1/model/phishscout'; // 🌟 替换成你实际的 Worker 路由
        
        const res = await fetch(WORKER_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${dewsecure_user.token}`,
                'X-Device-Id': dewsecure_user.deviceId || 'unknown'
            },
            cache: 'no-store'
        });

        if (!res.ok) {
            throw new Error(`Worker returned HTTP ${res.status}`);
        }
        
        const newModel = await res.json();
        
        // 3. 核心安全校验：防止拉下来的是恶意注入的脚本或损坏的 JSON
        if (newModel && newModel.nFeatures === 579 && Array.isArray(newModel.roots)) {
            await chrome.storage.local.set({ phishscout_model_data: newModel });
            console.log('🔄 [AI] PhishScout 模型热更新成功 (R2+Worker 安全下发)');
            
            // 通知运行中的模块重新加载模型
            chrome.runtime.sendMessage({ type: 'PHISH_MODEL_UPDATED' }).catch(() => {});
            return true;
        } else {
            throw new Error('Model schema validation failed');
        }
    } catch (e) {
        console.warn('⚠️ [AI] 模型热更新拉取失败，静默使用内置基础模型', e.message);
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
