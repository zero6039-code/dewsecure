(function () {
    'use strict';
    
    // 🌟 官网与本地开发环境白名单
    const hostname = window.location.hostname;
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
    if (SPA_SAFE_LIST.some(d => window.location.hostname.includes(d))) {
        console.warn('🛡️ [DewSecure] 检测到复杂 SPA 站点，已自动豁免 DOM 清理以防止白屏。');
        return; 
    }

    window.__dewsecureInjected = true;

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
    function analyzePageForPhishing() {
        const hostname = window.location.hostname;
        
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        if (passwordInputs.length === 0) return;

        let score = 40;
        const reasons = ['检测到密码输入框'];

        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            const action = form.getAttribute('action');
            if (!action) continue;
            
            if (action.startsWith('data:') || action.startsWith('blob:')) {
                score += 20;
                reasons.push('表单使用了 data:/blob: 提交');
            } else {
                try {
                    const actionUrl = new URL(action, window.location.href);
                    const getBaseDomain = (h) => h ? h.split('.').slice(-2).join('.') : '';
                    if (getBaseDomain(actionUrl.hostname) !== getBaseDomain(hostname)) {
                        score += 30;
                        reasons.push(`表单跨域提交至 ${actionUrl.hostname}`);
                    }
                } catch (e) {}
            }
        }

        const title = document.title.toLowerCase();
        const BRANDS = ['paypal', 'apple', 'microsoft', 'google', 'amazon', 'netflix', 'binance', 'coinbase', 'facebook', 'instagram'];
        for (const brand of BRANDS) {
            if (title.includes(brand) && !hostname.includes(brand)) {
                score += 20;
                reasons.push(`页面标题包含品牌词 [${brand}] 但域名不匹配`);
                break;
            }
        }

        const iframes = document.querySelectorAll('iframe');
        for (const iframe of iframes) {
            try {
                const src = iframe.src;
                if (src && src.startsWith('http')) {
                    const iframeUrl = new URL(src);
                    const getBaseDomain = (h) => h ? h.split('.').slice(-2).join('.') : '';
                    if (getBaseDomain(iframeUrl.hostname) !== getBaseDomain(hostname)) {
                        const style = window.getComputedStyle(iframe);
                        if (style.display === 'none' || style.visibility === 'hidden' || parseInt(style.width) <= 1) {
                            score += 10;
                            reasons.push('检测到隐藏的跨域 iframe');
                            break;
                        }
                    }
                }
            } catch(e) {}
        }

        if (score >= 60) {
            console.warn(`🚨 [DewSecure] 本地启发式检测到疑似钓鱼行为 (得分: ${score})`, reasons);
            triggerPhishingWarning(score, reasons, passwordInputs);
        }
    }

    function triggerPhishingWarning(score, reasons, passwordInputs) {
        passwordInputs.forEach(input => {
            input.disabled = true;
            input.style.backgroundColor = '#ffebee';
            input.style.border = '2px solid #ef4444';
            input.placeholder = '⚠️ DewSecure 已锁定该输入框';
        });
        document.querySelectorAll('form button[type="submit"], form input[type="submit"]').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });

        if (document.getElementById('dewsecure-phishing-warning')) return;

        const banner = document.createElement('div');
        banner.id = 'dewsecure-phishing-warning';
        banner.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
            background: #ef4444; color: white; padding: 12px 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px; display: flex; justify-content: space-between; align-items: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;
        banner.innerHTML = `
            <div>
                <strong>🚨 安全警告：</strong>此页面疑似钓鱼网站，您的密码可能会被窃取。
                <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">原因: ${reasons.join(', ')}</div>
            </div>
            <button id="dewsecure-phishing-ignore" style="background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;">我确定安全，继续</button>
        `;
        document.body.appendChild(banner);

        document.getElementById('dewsecure-phishing-ignore').addEventListener('click', () => {
            banner.remove();
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
            console.warn('🛡️ [DewSecure] 用户选择了忽略警告，已恢复表单输入。');
        });
    }

    // ===== 核心初始化 =====
    function init() {
        const skipDomains = ['google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'wired.com'];
        if (skipDomains.some(d => window.location.hostname.endsWith(d))) {
            console.log('🛡️ [DewSecure] 核心站点豁免 DOM 清理，防止 SPA 崩溃。');
            return;
        }

        try {
            chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
                if (chrome.runtime.lastError || !settings) return;
                
                const host = window.location.hostname;
                const m = d => host === d || host.endsWith('.' + d);
                if ((settings.whitelist || []).some(m) || (settings.tempWhitelist || []).some(m)) {
                    document.documentElement.setAttribute('data-dewsecure-paused', 'true');
                    console.log('🛡️ [DewSecure] 命中白名单，已停止注入 CSS 与 Hook。');
                    window.postMessage({ type: 'DEWSECURE_PAUSE' }, '*');
                    return;
                }

                window.postMessage({ type: 'DEWSECURE_SETTINGS', settings }, '*');

                // 🚀 启动页面级钓鱼检测
                setTimeout(() => {
                    try { analyzePageForPhishing(); } catch (e) { console.warn(e); }
                }, 1000);

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


