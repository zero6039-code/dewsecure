import { state } from './content/state.js';
import { initPerformanceMonitor } from './content/performance.js';
import { analyzePageForPhishing, checkBitB } from './content/heuristics.js';
import { initQRScanner } from './content/qrScanner.js';
import { sanitizeForLLM } from './content/sanitizeForLLM.js';

(function () {
    'use strict';

    const hostname = window.location.hostname;
    const inList = (h, list) => list.some(d => h === d || h.endsWith('.' + d));
    if (
        hostname === 'dewsecure.com' || hostname.endsWith('.dewsecure.com') ||
        hostname === 'localhost' || hostname === '127.0.0.1'
    ) {
        console.log('🛡️ [DewSecure] 官方域名与本地环境，已自动跳过内容清理。');
        return;
    }

    if (window.__dewsecureInjected) return;

    const SPA_SAFE_LIST = ['wired.com', 'forbes.com'];
    if (inList(window.location.hostname, SPA_SAFE_LIST)) {
        console.warn('🛡️ [DewSecure] 检测到复杂 SPA 站点，已自动豁免 DOM 清理以防止白屏。');
        return;
    }

    window.__dewsecureInjected = true;
    // 🛡️ 修复 2.2：建立与主世界(mainWorld.js)的私有 MessageChannel 通信
    function connectPage() {
        if (state.toPage) return; // 防止重复建立
        try {
            const ch = new MessageChannel();
            state.toPage = ch.port1;
            
            // 监听来自主世界的消息 (如统计增量)
            ch.port1.onmessage = (ev) => {
                if (ev.data && ev.data.type === 'DEWSECURE_STAT_INCREMENT') {
                    // 信任边界修复：在此处添加限速/去重逻辑，暂不直接计入核心指标，仅作为提示
                    safeSendMessage({ type: 'DOM_AD_HIDDEN', url: window.location.href });
                }
            };
            
            // 将 port2 传递给主世界
            const targetOrigin = location.origin === 'null' ? '*' : location.origin;
            window.postMessage({ type: 'DEWSECURE_PORT_INIT' }, targetOrigin, [ch.port2]);
        } catch (e) {
            console.warn('[DewSecure] 建立私有通道失败:', e);
        }
    }

    // 监听主世界的握手请求 (应对脚本加载顺序竞争)
    window.addEventListener('message', (e) => {
        if (e.source === window && e.data && e.data.type === 'DEW_HELLO') {
            connectPage();
        }
    }, { once: false });

    // 主动尝试握手 (内容脚本通常先于主世界脚本运行)
    connectPage();


    function safeSendMessage(msg) {
        try {
            if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage(msg).catch(() => {});
            }
        } catch (e) {}
    }

    initPerformanceMonitor(safeSendMessage);



    // 🛡️ 修复 A-2：移除可被页面伪造的全局监听器；合法统计仅经 connectPage 的私有端口 port1.onmessage 上报

    function init() {
        const hostname = window.location.hostname;
        const QR_SKIP_HOSTS = [
            'accounts.google.com', 
            'login.microsoftonline.com', 
            'appleid.apple.com',
            'github.com'
        ];
        const shouldSkipQR = QR_SKIP_HOSTS.some(d => hostname === d || hostname.endsWith('.' + d));

        const skipDomains = ['google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'wired.com'];
        const isSkipDomain = skipDomains.some(d => window.location.hostname === d || window.location.hostname === 'www.' + d);

        if (isSkipDomain) {
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
                    if (state.toPage) state.toPage.postMessage({ type: 'DEWSECURE_PAUSE' });
                    return;
                }

                const safeSettings = {
                    antiHijackEnabled: settings.antiHijackEnabled,
                    antiBypassEnabled: settings.antiBypassEnabled,
                    blockSocialTrackers: settings.blockSocialTrackers
                };
                if (state.toPage) state.toPage.postMessage({ type: 'DEWSECURE_SETTINGS', settings: safeSettings });

                try {
                    let lang = (await chrome.storage.local.get('preferred_lang')).preferred_lang || 'en';
                    if (lang === 'zh_CN' || lang === 'zh-cn') lang = 'zh';
                    if (lang === 'en_US' || lang === 'en-us') lang = 'en';
                    const res = await fetch(chrome.runtime.getURL(`popup/locales/${lang}.json`));
                    if (res.ok) {
                        state.contentDict = await res.json();
                        if (state.toPage) state.toPage.postMessage({ type: 'DEWSECURE_I18N', dict: state.contentDict });
                        window.postMessage({ type: 'DEWSECURE_I18N', dict: state.contentDict }, '*');
                    }
                } catch (e) {
                    if (settings.i18n_dict) {
                        state.contentDict = settings.i18n_dict;
                        if (state.toPage) state.toPage.postMessage({ type: 'DEWSECURE_I18N', dict: state.contentDict });
                        window.postMessage({ type: 'DEWSECURE_I18N', dict: state.contentDict }, '*');
                    }
                }

                setTimeout(() => {
                    try { analyzePageForPhishing(); } catch (e) { console.warn(e); }
                }, 1000);

                let timer;
                const observer = new MutationObserver(() => {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        try { 
                            checkBitB(); 
                            analyzePageForPhishing(); 
                        } catch (e) {}
                    }, 500);
                });
                observer.observe(document.documentElement, { childList: true, subtree: true });

                setTimeout(() => {
                    const FINANCE = ['bank', 'paypal', 'chase', 'visa', 'mastercard', 'stripe', 'alipay', 'binance', 'coinbase'];
                    const isFinance = FINANCE.some(k => host.includes(k));

                    if ((settings.hideCookieNotices !== false || settings.hideAdPlaceholders !== false) && !isFinance) {
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = chrome.runtime.getURL('src/content.css');
                        link.id = '__dewsecure_style_all';
                        document.head.appendChild(link);

                        setTimeout(() => {
                            if (document.body && window.getComputedStyle(document.body).overflow === 'hidden') {
                                document.body.style.setProperty('overflow', 'auto', 'important');
                                document.documentElement.style.setProperty('overflow', 'auto', 'important');
                            }
                        }, 1000);
                    }
                }, 100);

                // 🛡️ SAN-5 修复：启动二维码扫描（内部自带延迟和特性检测）
                if (!shouldSkipQR) {
                    initQRScanner();
                }
            });
        } catch(e) {}
        
        // 🛡️ SAN-5 修复：强制启动二维码扫描
        try {
            if (!shouldSkipQR) {
                initQRScanner();
            }
        } catch (e) {
            console.error('🚨 [DewSecure] 启动二维码扫描器失败:', e);
        }
    }

    init();
})();

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

    if (msg.type === 'I18N_CHANGED') {
        (async () => {
            try {
                let lang = (await chrome.storage.local.get('preferred_lang')).preferred_lang || 'en';
                if (lang === 'zh_CN' || lang === 'zh-cn') lang = 'zh';
                if (lang === 'en_US' || lang === 'en-us') lang = 'en';
                const res = await fetch(chrome.runtime.getURL(`popup/locales/${lang}.json`));
                if (res.ok) {
                    state.contentDict = await res.json();
                    if (state.toPage) state.toPage.postMessage({ type: 'DEWSECURE_I18N', dict: state.contentDict });
                    window.postMessage({ type: 'DEWSECURE_I18N', dict: state.contentDict }, '*');
                    console.log('🛡️ [DewSecure] 网页端警告栏语言已实时更新');
                }
            } catch (e) {
                console.warn('⚠️ [DewSecure] 语言切换失败', e);
            }
            sendResponse({ ok: true });
        })();
        return true;
    }
});



        