// ==========================================
// 🚀 静默众包情报上报器 (K-匿名)
// ==========================================

export async function initIntelReporter() {
    // 每天执行一次（1440 分钟）
    chrome.alarms.create('dewsecure_report_candidates', { periodInMinutes: 1440 });
    
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name === 'dewsecure_report_candidates') {
            await reportCandidates();
        }
    });

    // 延迟 10 秒执行一次（用于测试或上次未发完的补偿）
    setTimeout(reportCandidates, 10000);
}

async function reportCandidates() {
    try {
        const res = await chrome.storage.local.get(['ai_suggested_rules', 'dewsecure_installation_id', 'dewsecure_user']);
        const rules = res.ai_suggested_rules || [];
        if (rules.length === 0) return;

        // 1. 隐私保护：只提取域名和置信度，丢弃上下文
        const payload = rules.map(r => ({ 
            domain: r.domain, 
            score: parseFloat(Number(r.score).toFixed(2)) 
        }));
        
        // 2. 获取唯一标识用于防刷 (K-匿名)
        let reporterId = res.dewsecure_installation_id || 'unknown_device';
        if (res.dewsecure_user && res.dewsecure_user.token) {
            reporterId = 'user_' + (res.dewsecure_user.email || 'unknown');
        }

        console.log(`[IntelReporter] 准备上报 ${payload.length} 条候选情报...`);

        // 3. 发送到 Worker
        const resp = await fetch('https://api.dewsecure.com/api/intel/contribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                reporterId: reporterId,
                rules: payload
            })
        });

        if (resp.ok) {
            // 4. 上报成功，清空本地池，防止重复上报
            await chrome.storage.local.set({ ai_suggested_rules: [] });
            console.log(`✅ [IntelReporter] 候选情报上报成功，本地缓存已清空`);
        } else {
            console.warn(`⚠️ [IntelReporter] 上报失败，状态码: ${resp.status}`);
        }
    } catch (e) {
        console.warn('❌ [IntelReporter] 情报上报异常:', e);
    }
}
