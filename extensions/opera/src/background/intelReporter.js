// ==========================================
// 🚀 静默众包情报上报器 (K-匿名)
// ==========================================

import { ensureAlarm, due } from './alarmHelper.js';
import { parse, getDomain } from 'tldts';

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
        const res = await chrome.storage.local.get(['ai_suggested_rules', 'dewsecure_installation_id', 'dewsecure_settings']);

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
            .map(r => {
                // 🛡️ A-12 修复：强制对 score 进行类型和范围裁剪，防止客户端极端投毒
                let s = parseFloat(r.score);
                if (isNaN(s)) s = 0;
                s = Math.max(0.1, Math.min(100, s)); // 限制在 0.1 - 100 之间
                return {
                    domain: getDomain(r.domain),
                    score: Number(s.toFixed(1))
                };
            });

        if (validRules.length === 0) return;

        // 🛡️ A-12 修复：使用 Web Crypto API 生成真正的 SHA-256 匿名 ID
        const monthStr = new Date().toISOString().slice(0, 7).replace('-', ''); // e.g. '202611'
        let reporterId = res.dewsecure_installation_id || 'unknown_device';
        const rawId = `${reporterId}_${monthStr}`;
        
        let anonId = 'anon_unknown';
        try {
            const msgBuffer = new TextEncoder().encode(rawId);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            anonId = `anon_${hashHex.substring(0, 12)}_${monthStr}`; // 截取前 12 位确保唯一性
        } catch (e) {
            console.warn('[IntelReporter] 生成匿名哈希失败，跳过本次上报。');
            return;
        }

        console.log(`[IntelReporter] 准备上报 ${validRules.length} 条候选情报... (Anon: ${anonId})`);

        // 🛡️ A-12 修复：移除 Authorization 头（彻底切断身份关联）
        // 如果服务端为了防刷必须校验身份，建议使用独立的匿名可撤销 Token，而不是用户主 JWT
        const headers = { 'Content-Type': 'application/json' };

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
