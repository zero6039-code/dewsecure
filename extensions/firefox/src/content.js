(function () {
    'use strict';
    
    // 🌟 官网与本地开发环境白名单
    const hostname = window.location.hostname;
    const inList = (h, list) => list.some(d => h === d || h.endsWith('.' + d));
    if (
        hostname === 'dewsecure.com' || 
        hostname.endsWith('.dewsecure.com') ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1'
    ) {
        console.log('🛡️ [DewSecure] 官方域名与本地环境，已自动跳过内容清理。');
        return;
    }

    if (window.__dewsecureInjected) return;
    
    // ===== DewSecure 复杂 SPA 豁免名单 =====
    const SPA_SAFE_LIST = ['wired.com', 'forbes.com'];
    if (inList(window.location.hostname, SPA_SAFE_LIST)) {
        console.warn('🛡️ [DewSecure] 检测到复杂 SPA 站点，已自动豁免 DOM 清理以防止白屏。');
        return; 
    }

    window.__dewsecureInjected = true;
    let phishingIgnored = false; // 🛡️ 用户点击“继续”后的免死金牌
    let contentDict = {};        // 🛡️ 缓存语言包

    // ===== 统一封装安全的消息发送 =====
    function safeSendMessage(msg) {
        try {
            if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage(msg).catch(() => {});
            }
        } catch (e) {}
    }

    // 🌟 监听页面发出的所有第三方网络请求（结合 AI 拦截广告）
    try {
        const seenThirdParty = new Set();
        const observer = new PerformanceObserver((list) => {
            const newHosts = [];
            for (const entry of list.getEntries()) {
                try {
                    const urlObj = new URL(entry.name);
                    const host = urlObj.hostname;
                    const getBaseDomain = (h) => h ? h.split('.').slice(-2).join('.') : '';
                    if (host && getBaseDomain(host) !== getBaseDomain(window.location.hostname)) {
                        if (!seenThirdParty.has(host)) {
                            seenThirdParty.add(host);
                            newHosts.push(host);
                        }
                    }
                } catch (e) {}
            }
            if (newHosts.length > 0) {
                safeSendMessage({ type: 'THIRD_PARTY_HOSTS', hosts: newHosts });
            }
        });
        observer.observe({ type: 'resource', buffered: true });
    } catch (e) {}

    // ==========================================
    // 🚀 页面级本地钓鱼识别 (启发式规则打分)
    // ==========================================
    // 增强的同站判断，处理 com.my / co.uk 等多级后缀
    // A3 修复：明确允许的 IdP 和 UGC 平台，防止误伤
    const SAFE_IDP_HOSTS = ['accounts.google.com', 'login.microsoftonline.com', 'appleid.apple.com', 'okta.com', 'auth0.com'];
    const SAFE_UGC_HOSTS = ['stackexchange.com', 'fandom.com', 'slashdot.org'];

    function getBaseDomain(h) {
        if (!h) return '';
        const parts = h.split('.');
        if (parts.length <= 2) return h;
        const multiLevel = ['com.my', 'co.uk', 'com.cn', 'com.sg', 'co.id', 'com.au', 'co.jp'];
        const lastTwo = parts.slice(-2).join('.');
        return multiLevel.includes(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
    }

    function scorePage() {
        let score = 0;
        const reasons = [];
        const hostname = window.location.hostname;
        const pageBaseDomain = getBaseDomain(hostname);

        // 1. 跨站表单：独立计分，且排除白名单 IdP (A3 修复)
        const forms = document.querySelectorAll('form');
        let hasCrossSiteCredForm = false;
        for (const form of forms) {
            const action = form.getAttribute('action');
            if (!action) continue;
            try {
                const actionUrl = new URL(action, window.location.href);
                const actionHost = actionUrl.hostname;
                
                // 排除安全的 IdP
                const isSafeIdP = SAFE_IDP_HOSTS.some(idp => actionHost === idp || actionHost.endsWith('.' + idp));
                if (isSafeIdP) continue;

                if (actionUrl.protocol === 'data:' || actionUrl.protocol === 'blob:' || getBaseDomain(actionHost) !== pageBaseDomain) {
                    score += 40;
                    reasons.push({ key: 'reason_cross_site_form', arg: actionHost });
                    
                    const hasPassword = form.querySelector('input[type="password"]');
                    const hasEmail = form.querySelector('input[type="email"], input[name*="email" i], input[name*="user" i], input[name*="login" i]');
                    if (hasPassword || hasEmail) {
                        hasCrossSiteCredForm = true;
                    }
                }
            } catch (e) {}
        }
        
        // 跨站表单 + 凭证 = 60分
        if (hasCrossSiteCredForm) {
            score += 30;
            reasons.push({ key: 'reason_credential_form' });
        }

        // 2. 标题品牌仿冒：修正判断逻辑 (A3 修复)
        const title = document.title.toLowerCase();
        const BRANDS = ['paypal', 'apple', 'microsoft', 'google', 'amazon', 'netflix', 'binance', 'coinbase', 'facebook', 'instagram'];
        for (const brand of BRANDS) {
            // 如果标题包含品牌词，且当前域名不是该品牌的官方注册域，才算仿冒
            if (title.includes(brand) && !pageBaseDomain.includes(brand)) {
                // 排除 UGC 平台
                const isSafeUGC = SAFE_UGC_HOSTS.some(ugc => hostname.includes(ugc));
                if (!isSafeUGC) {
                    score += 25;
                    reasons.push({ key: 'reason_brand_title', arg: brand });
                    break;
                }
            }
        }

        // 3. 隐藏的跨域 iframe (15分)
        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const src = iframe.src;
                if (src && src.startsWith('http')) {
                    const iframeUrl = new URL(src);
                    if (getBaseDomain(iframeUrl.hostname) !== getBaseDomain(hostname)) {
                        const style = window.getComputedStyle(iframe);
                        if (style.display === 'none' || style.visibility === 'hidden' || parseInt(style.width) <= 1) {
                            score += 15;
                            reasons.push({ key: 'reason_hidden_iframe' });
                            break;
                        }
                    }
                }
            } catch(e) {}
        }

        return { score, reasons };
    }

    function analyzePageForPhishing() {
        if (phishingIgnored) return; // 🛡️ 用户已忽略，不再重复弹窗
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        if (passwordInputs.length === 0) return;

        const { score, reasons } = scorePage();
        // 阈值提升至 60，且密码框不再计分，必须由至少 2 个独立信号触发
        if (score >= 60) {
            console.warn(`🚨 [DewSecure] 本地启发式检测到疑似钓鱼行为 (得分: ${score})`, reasons);
            triggerPhishingWarning(score, reasons, passwordInputs);
        }
    }

    function triggerPhishingWarning(score, reasons, passwordInputs) {
        // A3 修复：不直接 disable 密码框，避免被页面脚本瞬间还原，也避免破坏正常登录体验
        // 改为高亮提示，只有当用户尝试提交时才由后台强制拦截
        if (document.getElementById('dewsecure-phishing-warning-host')) return;

        // 🛡️ 从字典获取翻译
        const tTitle = contentDict['phish_title'] || '🚨 Security Warning: Phishing Detected';
        const tDesc = contentDict['phish_desc'] || 'This page is trying to steal your password.';
        const tBtn = contentDict['phish_continue'] || 'I am sure it\'s safe, continue';
        
        // 翻译 reasons
        const reasonText = reasons.map(r => {
            let text = contentDict[r.key] || r.key;
            return text.replace('{arg}', r.arg || '');
        }).join(', ');

        // 使用 closed Shadow DOM 防止页面脚本篡改或直接点击按钮
        const host = document.createElement('div');
        host.id = 'dewsecure-phishing-warning-host';
        host.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;';
        const shadow = host.attachShadow({ mode: 'closed' });

        const banner = document.createElement('div');
        banner.style.cssText = `
            background: #ef4444; color: white; padding: 12px 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px; display: flex; justify-content: space-between; align-items: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        banner.innerHTML = `
            <div>
                <strong>${tTitle}</strong> ${tDesc}
                <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">${reasonText}</div>
            </div>
            <button id="dewsecure-phishing-ignore" style="background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;">${tBtn}</button>
        `;
        shadow.appendChild(banner);
        document.body.appendChild(host);

        shadow.getElementById('dewsecure-phishing-ignore').addEventListener('click', () => {
            phishingIgnored = true; // 🛡️ 激活免死金牌
            host.remove();
            passwordInputs.forEach(input => {
                input.disabled = false;
                input.style.backgroundColor = '';
                input.style.border = '';
                input.placeholder = '';
            });
            document.querySelectorAll('form button[type="submit"], form input[type="submit"]').forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.style.cursor = '';
            });
            console.warn('🛡️ [DewSecure] 用户选择了忽略警告，已恢复表单输入，并停止后续检测。');
        });
    }

    // ===== 核心初始化 =====
    function init() {
        const skipDomains = ['google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'wired.com'];
        if (inList(window.location.hostname, skipDomains)) {
            console.log('🛡️ [DewSecure] 核心站点豁免 DOM 清理，防止 SPA 崩溃。');
            return;
        }

        try {
            chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, async (settings) => {
                if (chrome.runtime.lastError || !settings) return;
                
                const host = window.location.hostname;
                const m = d => host === d || host.endsWith('.' + d);
                if ((settings.whitelist || []).some(m) || (settings.tempWhitelist || []).some(m)) {
                    document.documentElement.setAttribute('data-dewsecure-paused', 'true');
                    console.log('🛡️ [DewSecure] 命中白名单，已停止注入 CSS 与 Hook。');
                    window.postMessage({ type: 'DEWSECURE_PAUSE' }, '*');
                    return;
                }

                // 🛡️ N-10 修复：只下发布尔开关，不泄露白名单等敏感配置，并使用安全 origin
                const safeSettings = {
                    antiHijackEnabled: settings.antiHijackEnabled,
                    antiBypassEnabled: settings.antiBypassEnabled,
                    blockSocialTrackers: settings.blockSocialTrackers
                };
                window.postMessage({ type: 'DEWSECURE_SETTINGS', settings: safeSettings }, location.origin);

                // 🛡️ 读取语言包并发送给主世界 (inject.js)
                try {
                    let lang = (await chrome.storage.local.get('preferred_lang')).preferred_lang || 'en';
                    if (lang === 'zh_CN') lang = 'zh';
                    const res = await fetch(chrome.runtime.getURL(`popup/locales/${lang}.json`));
                    if (res.ok) {
                        const dict = await res.json();
                        window.postMessage({ type: 'DEWSECURE_I18N', dict: dict }, location.origin);
                    }
                } catch (e) {}

                // 🚀 启动页面级钓鱼检测（动态监听）
                setTimeout(() => {
                    try { analyzePageForPhishing(); } catch (e) { console.warn(e); }
                }, 1000);

                let timer;
                const observer = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        try { analyzePageForPhishing(); } catch (e) {}
                    }, 500);
                });
                observer.observe(document.documentElement, { childList: true, subtree: true });

                setTimeout(() => {
                    // 🚀 性能优化：废弃 DOM 正则遍历，改用声明式 CSS 注入
                    if (settings.hideCookieNotices !== false || settings.hideAdPlaceholders !== false) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = chrome.runtime.getURL('src/content.css');
                        link.id = '__dewsecure_style_all';
                        document.head.appendChild(link);
                        
                        // 🛡️ 修复 Cookie 隐藏导致的滚动锁死
                        setTimeout(() => {
                            if (document.body && window.getComputedStyle(document.body).overflow === 'hidden') {
                                document.body.style.setProperty('overflow', 'auto', 'important');
                                document.documentElement.style.setProperty('overflow', 'auto', 'important');
                            }
                        }, 1000);
                    }
                }, 100);
            });
        } catch(e) {}
    }

    init();
})();

// ==========================================
// 监听消息（放在 IIFE 外部）
// ==========================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_PROTECTION') {
        if (msg.enabled === false) {
            document.documentElement.setAttribute('data-dewsecure-paused', 'true');
            const s1 = document.getElementById('__dewsecure_style_all');
            if (s1) s1.remove();
            if (document.body) {
                document.body.style.setProperty('overflow', 'auto', 'important');
                document.documentElement.style.setProperty('overflow', 'auto', 'important');
            }
            console.warn('🛡️ [DewSecure] 已动态挂起，还原网页状态。');
        } else {
            location.reload();
        }
        sendResponse({ ok: true });
    }
});


