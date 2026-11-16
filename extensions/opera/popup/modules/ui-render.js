import { getCurrentUser } from '../../src/authManager.js';
import { updateSiteSwitch, disableSiteSwitch } from '../views.js';

// 🛡️ S-13 修复：HTML 实体转义，防止恶意 URL 注入 XSS
function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag])
    );
}


// 🛡️ M-6 终极修复：兼容历史遗留的缺失 domain 的旧数据
function extractDomain(log) {
    if (log.domain && log.domain !== '未知') return log.domain;
    if (!log.url) return '未知';
    try {
        if (log.url.startsWith('http')) return new URL(log.url).hostname;
        return log.url.split('/')[0];
    } catch (e) {
        return '未知';
    }
}

export function getTypeText(type) { 
    const t = window.t || (window.i18n && window.i18n.t) || ((k) => k); 
    const map = { dnr: "type_dnr", tracker: "type_tracker", ad: "type_ad", "dom-hidden": "type_dom_hidden" }; 
    const key = map[type]; 
    return (key && t(key)) ? t(key) : type; 
}

let siteInfoReqId = 0;
export async function updateSiteInfo() {
    const currentReqId = ++siteInfoReqId;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && /^https?:/.test(tab.url)) {
            const host = new URL(tab.url).hostname;
            const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
            const finalSettings = settings || {};
            const matchDomain = (d) => host === d || host.endsWith('.' + d);
            const isWhitelisted = (finalSettings.whitelist || []).some(matchDomain);
            const isTempWhitelisted = (finalSettings.tempWhitelist || []).some(matchDomain);
            
            if (currentReqId !== siteInfoReqId) return; 
            updateSiteSwitch(!isWhitelisted && !isTempWhitelisted, host);
            document.getElementById('siteDomain').textContent = host;
            document.getElementById('siteDomain').removeAttribute('data-i18n');
        } else {
            if (currentReqId !== siteInfoReqId) return;
            disableSiteSwitch();
            document.getElementById('siteDomain').setAttribute('data-i18n', 'site_this');
            document.getElementById('siteDomain').textContent = window.t('site_this');
        }
    } catch (e) {
        console.error("❌ updateSiteInfo 执行出错:", e);
        disableSiteSwitch();
    }
}

export async function renderTodayLogs() {
    const [resLogs, resStats] = await Promise.all([
        chrome.storage.local.get('dewsecure_logs'),
        chrome.storage.local.get('dewsecure_stats')
    ]);
    const logs = Array.isArray(resLogs.dewsecure_logs) ? resLogs.dewsecure_logs : [];
    const stats = resStats.dewsecure_stats || {};
    const todayStr = new Date().toDateString();
    const todayLogs = logs.filter(l => l.date === todayStr);

    // 🛡️ 修复：获取真实的今日拦截总数，如果大于日志条数，显示“+”
    const realTodayBlocked = stats.date === todayStr ? stats.todayBlocked : 0;
    const displayCount = realTodayBlocked > todayLogs.length ? `${todayLogs.length}+` : todayLogs.length;
    
    const badge = document.getElementById('logCountBadge');
    if (badge) badge.textContent = `${displayCount} ${window.t('log_items')}`;

    const list = document.getElementById('logsList');
    if (!list) return;

    if (todayLogs.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: #9ca3af; font-size: 12px; padding: 20px;">${window.t('logs_empty') || '暂无拦截记录'}</div>`;
        return;
    }

    const grouped = {};
    todayLogs.forEach(log => {
        const d = extractDomain(log);
        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(log);
    });

    const sortedDomains = Object.keys(grouped).map(domain => ({
        domain: domain,
        count: grouped[domain].length,
        records: grouped[domain].reverse()
    })).sort((a, b) => b.count - a.count);

    list.innerHTML = sortedDomains.map((item) => {
        const firstRecord = item.records[0];
        const time = new Date(firstRecord.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const innerHTML = item.records.map(r => {
            const rTime = new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `<div style="display: flex; justify-content: space-between; padding: 6px 10px; font-size: 11px; color: #6b7280; border-bottom: 1px solid rgba(0,0,0,0.05);">
                <span>${escapeHTML(r.url || '未知路径')}</span>
                <span>${rTime}</span>
            </div>`;
        }).join('');

        return `
        <details class="hover-card" style="background: rgba(255,255,255,0.6); border-radius: 8px; margin-bottom: 8px; overflow: hidden;">
            <summary style="display: flex; justify-content: space-between; align-items: center; padding: 10px; outline: none; list-style: none;">
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 600; font-size: 13px; color: #1c1c1e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(item.domain)}</div>
                    <div style="font-size: 11px; color: #6b7280;">${getTypeText(firstRecord.type)}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 12px; font-weight: bold; color: #3b82f6; background: rgba(59,130,246,0.1); padding: 2px 8px; border-radius: 12px;">${item.count} ${window.t('log_times')}</span>
                    <span style="font-size: 11px; color: #9ca3af;">${time}</span>
                </div>
            </summary>
            <div style="background: rgba(255,255,255,0.4); padding: 4px 0;">${innerHTML}</div>
        </details>`;
    }).join('');
}

export async function renderTotalStats() {
    const res = await chrome.storage.local.get('dewsecure_logs');
    const logs = Array.isArray(res.dewsecure_logs) ? res.dewsecure_logs : [];
    const statsRes = await chrome.storage.local.get('dewsecure_stats');
    const totalBlocked = statsRes.dewsecure_stats?.totalBlocked || logs.length;

    const totalEl = document.getElementById('totalStatsValue');
    if (totalEl) totalEl.textContent = totalBlocked;

    const domainCounts = {};
    logs.forEach(log => {
        const d = extractDomain(log);
        if (d && d !== '未知') {
            domainCounts[d] = (domainCounts[d] || 0) + 1;
        }
    });

    const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const list = document.getElementById('topDomainsList');
    if (!list) return;

    if (topDomains.length === 0) {
        list.innerHTML = `<div style="text-align: center; color: #9ca3af; font-size: 12px; padding: 10px;">暂无数据</div>`;
        return;
    }

    list.innerHTML = topDomains.map((item, index) => {
        return `<div class="hover-card" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background: rgba(255,255,255,0.6); border-radius: 8px;">
            <div style="font-size: 13px; font-weight: 500; color: #1c1c1e;">
                <span style="color: #6b7280; margin-right: 5px;">${index + 1}</span> ${escapeHTML(item[0])}
            </div>
            <div style="font-size: 13px; font-weight: bold; color: #58a6ff;">${item[1]}</div>
        </div>`;
    }).join('');
}

export async function updateUserUI(user) {
    const loginText = document.getElementById('loginBtnText');
    if (loginText) loginText.textContent = user ? window.t('btn_status') : window.t('btn_login');

    // 🌟 关键修复：页面加载时，先强制把 storage 里的状态同步到 UI，消灭数据脱节
    const allToggleMap = {
        'dnrToggle': 'dnrEnabled', 'antiHijackToggle': 'antiHijackEnabled',
        'trackerToggle': 'blockTrackers', 'antiBypassToggle': 'antiBypassEnabled',
        'cookieToggle': 'hideCookieNotices', 'placeholderToggle': 'hideAdPlaceholders',
        'socialToggle': 'blockSocialTrackers'
    };
    const { dewsecure_settings: initSettings } = await chrome.storage.local.get('dewsecure_settings');
    const iSet = initSettings || {};
    for (const [id, key] of Object.entries(allToggleMap)) {
        const el = document.getElementById(id);
        if (el && iSet[key] !== undefined) {
            el.checked = iSet[key] !== false;
        }
    }

    const upgradeBtn = document.getElementById('upgradeBtn');
    const upgradeText = document.querySelector('.btn-upgrade-text');
    const isPremium = user?.tier === 'pro' || user?.tier === 'family' || user?.tier === 'premium' || user?.tier === 'trial';

    // 🌟 核心修复：统一处理所有 PRO 开关的状态（Free 禁用/变灰，PRO 启用/恢复状态）
    const proSwitchConfig = {
        'phishingToggle': { key: 'phishingEnabled', default: true },
        'intelToggle': { key: 'intelEnabled', default: true },
        'aiFourToggle': { key: 'aiFourEnabled', default: true }
    };

    const { dewsecure_settings: settings } = await chrome.storage.local.get('dewsecure_settings');
    const s = settings || {};

    Object.entries(proSwitchConfig).forEach(([id, config]) => {
        const switchEl = document.getElementById(id);
        if (!switchEl) return;
        
        const container = switchEl.closest('.feature-row') || switchEl.closest('label') || switchEl.parentElement;
        
        if (!isPremium) {
            switchEl.checked = false;
            switchEl.disabled = true; // 🔒 F3 确保免费用户强制关闭
            if (container) {
                container.style.opacity = '0.4';
                container.style.pointerEvents = 'none';
            }
        } else {
            switchEl.disabled = false;
            if (container) {
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
            }
            // 🌟 移除所有强制覆盖逻辑。尊重用户本地存储的状态
            const savedVal = s[config.key];
            switchEl.checked = savedVal !== false;
        }
    });

    // 🌟 如果用户是 PRO，通知后台立刻拉取情报
    if (isPremium) {
        chrome.runtime.sendMessage({ type: 'FORCE_SYNC_PRO_DATA' });
    }

    if (upgradeBtn && upgradeText) {
        if (isPremium) {
            upgradeText.textContent = window.t('btn_upgraded') || 'Manage Subscription';
            upgradeBtn.onclick = () => {
                const baseUrl = 'https://dewsecure.com/dashboard.html';
                if (user.token) {
                    const url = new URL(baseUrl);
                    url.searchParams.set('token', user.token);
                    if (user.refreshToken) url.searchParams.set('refresh', user.refreshToken);
                    chrome.tabs.create({ url: url.toString() });
                } else {
                    chrome.tabs.create({ url: baseUrl });
                }
            };
            upgradeBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        } else {
            upgradeText.textContent = window.t('btn_upgrade') || 'Upgrade to Pro';
            upgradeBtn.onclick = () => {
                chrome.tabs.create({ url: 'https://dewsecure.com/pricing.html' });
            };
            upgradeBtn.style.background = 'linear-gradient(135deg, #FFD966, #FFC107)';
        }
    }

}


// ==========================================
// 📊 流量节省数据渲染 (V4 域名聚合版)
// ==========================================
export function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 KB';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y.slice(2)}`;
}

function getLocalDateStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export async function renderSavings() {
    try {
        const today = getLocalDateStr();
        const { savings = {}, savingsLogs = {} } = await chrome.storage.local.get(['savings', 'savingsLogs']);
        
        const todayData = savings[today] || { req: 0, bytes: 0 };
        let totalBytes = 0;
        Object.values(savings).forEach(d => totalBytes += (d.bytes || 0));

        const todayStr = formatBytes(todayData.bytes);
        const totalStr = formatBytes(totalBytes);

        // 1. 更新首页卡片
        const todayEl = document.getElementById('todaySaved');
        const totalEl = document.getElementById('totalSaved');
        if (todayEl) todayEl.textContent = todayStr;
        if (totalEl) totalEl.textContent = totalStr;

        // 2. 更新详情页卡片
        const dTodayEl = document.getElementById('detailsTodaySaved');
        const dTotalEl = document.getElementById('detailsTotalSaved');
        const dTodayDate = document.getElementById('detailsTodayDate');
        const dTotalDate = document.getElementById('detailsTotalDate');

        if (dTodayEl) dTodayEl.textContent = todayStr;
        if (dTotalEl) dTotalEl.textContent = totalStr;
        
        if (dTodayDate) dTodayDate.textContent = formatDate(today);
        
        const sortedDates = Object.keys(savings).sort();
        if (dTotalDate) {
            if (sortedDates.length > 0) {
                dTotalDate.textContent = `From ${formatDate(sortedDates[0])} to now`;
            } else {
                dTotalDate.textContent = `From ${formatDate(today)} to now`;
            }
        }

        // 3. 渲染明细列表 (聚合逻辑)
        const listContainer = document.getElementById('savingsListContainer');
        if (!listContainer) return;

        const logs = savingsLogs[today] || [];
        if (logs.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; color: #9ca3af; font-size: 13px; padding: 40px 20px; line-height: 1.6;">
                    <div data-i18n="savings_no_data_title">${window.t('savings_no_data_title') || 'No traffic savings yet.'}</div>
                    <div data-i18n="savings_no_data_desc" style="font-size: 12px;">${window.t('savings_no_data_desc') || 'Try browsing some ad-heavy websites.'}</div>
                </div>`;
            return;
        }

        // 🌟 聚合相同域名
        const grouped = {};
        logs.forEach(item => {
            if (!grouped[item.domain]) {
                grouped[item.domain] = { domain: item.domain, bytes: 0, count: 0, latestTime: item.time };
            }
            grouped[item.domain].bytes += item.bytes;
            grouped[item.domain].count += 1;
            // 因为 logs 是按时间顺序推入的，最新的在数组末尾
            grouped[item.domain].latestTime = item.time; 
        });

        // 转为数组并反转顺序（最新拦截的在上面）
        const groupedList = Object.values(grouped).reverse();

        listContainer.innerHTML = groupedList.map(item => `
            <div class="savings-list-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(255,255,255,0.4); border-radius: 12px; margin: 0 4px 8px 4px;">
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 600; font-size: 13px; color: #1c1c1e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.domain}</div>
                    <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">${item.latestTime} · ${item.count} ${window.t('log_times') || 'times'}</div>
                </div>
                <div style="font-size: 13px; font-weight: 700; color: #10b981; margin-left: 10px;">
                    - ${formatBytes(item.bytes)}
                </div>
            </div>
        `).join('');
        
        if (window.applyI18n) window.applyI18n();
    } catch (e) {
        console.warn('⚠️ [UI] 渲染流量节省失败:', e);
    }
}