// 下载和更新 AI 模型
export async function checkAndUpdatePhishModel() {
    try {
        // 你的 R2 公共访问域名，或者使用 workers 代理
        const R2_PUBLIC_URL = 'https://cdn.dewsecure.com/canary/phishscout_local.json'; 
        const res = await fetch(R2_PUBLIC_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('Fetch failed');
        
        const newModel = await res.json();
        // 基本校验
        if (newModel && newModel.nFeatures === 579 && newModel.roots) {
            await chrome.storage.local.set({ phishscout_model_data: newModel });
            console.log('🔄 [AI] PhishScout 模型热更新成功');
            // 通知所有界面重新加载
            chrome.runtime.sendMessage({ type: 'PHISH_MODEL_UPDATED' }).catch(() => {});
            return true;
        }
    } catch (e) {
        console.warn('⚠️ [AI] 热更新拉取失败，使用内置模型', e);
    }
    return false;
}

export async function getPhishModelData() {
    const { phishscout_model_data } = await chrome.storage.local.get('phishscout_model_data');
    if (phishscout_model_data) return phishscout_model_data;
    
    // 如果本地没有缓存，加载默认打包进去的 JSON
    const module = await import('../phishscout_local.json');
    return module.default || module;
}
