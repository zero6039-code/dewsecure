import { getSettings, LOG_KEY } from '../settings.js';
import { recordBlock, getMatchedStats } from '../stats.js';
import { cleanExpiredTempWhitelist } from '../tempWhitelistManager.js';
import { jwtPayload } from '../../authManager.js';
import { isValidWhitelistDomain, getETLD1 } from './validators.js';

const SB_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
const SB_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';

export async function handleDomAdHidden(message) {
    try {
        const host = new URL(message.url).hostname;
        let settings = await getSettings();
        settings = await cleanExpiredTempWhitelist(settings);
        const isWhitelisted = (settings.whitelist || []).some(d => host === d || host.endsWith('.' + d)) || (settings.tempWhitelist || []).some(d => host === d || host.endsWith('.' + d));
        if (!isWhitelisted) await recordBlock(host + '/dom-hidden', 'dom-hidden');
    } catch(e) {}
    return { ok: true };
}
export async function handleGetLogs() {
    let { [LOG_KEY]: rawLogs } = await chrome.storage.local.get(LOG_KEY);
    return Array.isArray(rawLogs) ? rawLogs : [];
}
export async function handleGetStats() {
    const stats = await getMatchedStats();
    let sStats = await getSettings();
    sStats = await cleanExpiredTempWhitelist(sStats);
    return { stats: stats, settings: sStats };
}
export async function handleReportFeedback(message) {
    try {
        const { dewsecure_user: user } = await chrome.storage.local.get('dewsecure_user');
        if (!user || !user.token) return { ok: false, error: 'Please login to report false positives/negatives' };
        let host = message.domain;
        let tab = null;
        if (!host) {
            [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url) return { ok: false };
            host = new URL(tab.url).hostname;
        }
        if (!message.domain && tab?.url && tab.url.includes('warning.html')) {
            const urlParams = new URL(tab.url).searchParams;
            const realDomain = urlParams.get('domain') || urlParams.get('url');
            if (realDomain && realDomain !== 'Known Malicious Site') {
                try { host = new URL(realDomain.startsWith('http') ? realDomain : `https://${realDomain}`).hostname; } catch(e) { host = realDomain; }
            }
        }
        if (host === chrome.runtime.id || !host.includes('.')) return { ok: false, error: 'Invalid domain' };
        if (!isValidWhitelistDomain(getETLD1(host))) return { ok: false, error: 'Invalid domain' };
        const domainOnly = getETLD1(host);
        let userId = null;
        if (user && user.token) {
            const payload = jwtPayload(user.token);
            if (payload) userId = payload.sub;
        }
        const authHeader = user?.token ? `Bearer ${user.token}` : `Bearer ${SB_KEY}`;
        const res = await fetch(`${SB_URL}/rest/v1/reports`, {
            method: 'POST',
            headers: { 'apikey': SB_KEY, 'Authorization': authHeader, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ user_id: userId, report_type: message.feedbackType === 'missed' ? 'false_negative' : 'false_positive', url: `https://${domainOnly}`, domain: domainOnly, description: domainOnly, category: 'ai_feedback' })
        });
        return { ok: res.ok };
    } catch (err) { return { ok: false }; }
}
