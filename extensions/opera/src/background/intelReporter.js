// ==========================================
// 🚀 静默众包情报上报器 (K-匿名)
// ==========================================

import { ensureAlarm, due } from './alarmHelper.js';
import { parse, getDomain } from 'tldts'; // 🛡️ N-9 修复：用于过滤内网域名

export async function initIntelReporter() {
    await ensureAlarm('dewsecure_report_candidates', { periodInMinutes: 1440, delayInMinutes: 1 });
    
    chrome.alarms.onAlarm.addListener(async (alarm) => {
        if (alarm.name === 'dewsecure_report_candidates') {
            await reportCandidates();
        }
    });

    if (await due('last_report_check', 6 * 3600e3)) {
        await reportCandidates();
    }
}

async function reportCandidates() {
    try {
        const res = await chrome.storage.local.get(['ai_suggested_rules', 'dewsecure_installation_id', 'dewsecure_user', 'dewsecure_settings']);
        
        // 🛡️ N-9 修复：必须用户显式同意才上报（默认关闭）
        const settings = res.dewsecure_settings || {};
        if (settings.shareThreatCandidates !== true) {
            return;
        }

        const rules = res.ai_suggested_rules || [];
        if (rules.length === 0) return;

        // 🛡️ N-9 修复：过滤内网/私有域名，防止企业拓扑泄露
        const isPublicDomain = (d) => {
            try {
                const p = parse(d, { allowPrivateDomains: false });
                return p.isIcann === true && p.domain !== null && p.isIp === false;
            } catch (e) { return false; }
        };

        // 🛡️ N-9 修复：按分数降序排列，仅取前 20 条，且仅提取注册域
        const validRules = rules
            .filter(r => isPublicDomain(r.domain))
            .sort((a, b) => b.score - a.score)
            .slice(0, 20)
            .map(r => ({
                domain: getDomain(r.domain), 
                score: parseFloat(Number(r.score).toFixed(1))
            }));

        if (validRules.length === 0) return;

        // 🛡️ N-9 修复：身份脱敏，每月轮换一次
        const monthStr = new Date().toISOString().slice(0, 7).replace('-', ''); // e.g. '202611'
        let reporterId = res.dewsecure_installation_id || 'unknown_device';
        // 用安装 ID 和月份生成一个不可逆的短哈希
        let hash = 0;
        const rawId = `${reporterId}_${monthStr}`;
        for (let i = 0; i < rawId.length; i++) {
            hash = ((hash << 5) - hash) + rawId.charCodeAt(i);
            hash |= 0;
        }
        const anonId = `anon_${Math.abs(hash).toString(36)}_${monthStr}`;

        console.log(`[IntelReporter] 准备上报 ${validRules.length} 条候选情报... (Anon: ${anonId})`);

        // 🛡️ N-9 修复：带上用户 Token（如果登录）以便后台鉴权，但绝不带邮箱
        const headers = { 'Content-Type': 'application/json' };
        if (res.dewsecure_user && res.dewsecure_user.token) {
            headers['Authorization'] = `Bearer ${res.dewsecure_user.token}`;
        }

        const resp = await fetch('https://api.dewsecure.com/api/intel/contribute', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                reporterId: anonId,
                rules: validRules
            })
        });

        if (resp.ok) {
            await chrome.storage.local.set({ ai_suggested_rules: [] });
            console.log(`✅ [IntelReporter] 候选情报上报成功，本地缓存已清空`);
        } else {
            console.warn(`⚠️ [IntelReporter] 上报失败，状态码: ${resp.status}`);
        }
    } catch (e) {
        console.warn('❌ [IntelReporter] 情报上报异常:', e);
    }
}
