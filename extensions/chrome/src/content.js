/**
 * DewSecure Content Script
 *
 * 负责：
 * 1. 注入反反拦截脚本
 * 2. 隐藏广告元素
 * 3. 与 Service Worker 通信
 */

(function () {
    'use strict';

    // 只在顶层文档注入一次
    if (window.__dewsecureInjected) return;
    window.__dewsecureInjected = true;

    // ============ 注入反反拦截脚本 ============

    function injectAntiBypass() {
        const script = document.createElement('script');
        script.textContent = generateAntiBypassCode();
        script.setAttribute('data-dewsecure', 'anti-bypass');

        const target = document.head || document.documentElement;
        target.insertBefore(script, target.firstChild);
        script.remove();
    }

    function generateAntiBypassCode() {
        const seed = Date.now();
        const varName = `_0x${(seed & 0xFFFFFFFF).toString(16)}`;

        return `
(function() {
    'use strict';
    const ${varName} = {
        adBlock: false,
        adblock: false,
        adsBlocked: 0,
        isAdBlockActive: false,
        canRunAds: true,
        canShowAds: true,
        adblockDetected: false,
    };
    const props = ['adBlock', 'adblock', 'adsBlocked', 'isAdBlockActive',
                   'canRunAds', 'canShowAds', 'adblockDetected'];
    for (const p of props) {
        try {
            Object.defineProperty(window, p, {
                get: () => ${varName}[p],
                configurable: true,
            });
        } catch(e) {}
    }
})();
`;
    }

    // ============ 隐藏广告元素 ============

    const AD_SELECTORS = [
        '[class*="ad-"]',
        '[class*="ads-"]',
        '[class*="advert"]',
        '[id*="ad-"]',
        '[id*="ads-"]',
        '[id*="advert"]',
        '[class*="banner"]',
        '[class*="popup"]',
        '[class*="sponsor"]',
        'iframe[src*="doubleclick"]',
        'iframe[src*="googlesyndication"]',
        'iframe[src*="ads"]',
        '[data-ad]',
        '[data-ads]',
        '[data-ad-slot]',
    ];

    function hideAdElements() {
        for (const selector of AD_SELECTORS) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    // 跳过太小或太大的元素
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 10 || rect.height < 10) continue;

                    // 跳过包含主要内容的元素
                    if (el.querySelector('article, main, [role="main"]')) continue;

                    el.style.setProperty('display', 'none', 'important');
                    el.style.setProperty('visibility', 'hidden', 'important');
                    el.style.setProperty('opacity', '0', 'important');
                }
            } catch (e) {
                // 忽略无效选择器
            }
        }
    }

    // ============ MutationObserver ============

    let hideTimeout = null;

    function scheduleHide() {
        if (hideTimeout) return;
        hideTimeout = setTimeout(() => {
            hideAdElements();
            hideTimeout = null;
        }, 100);
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                scheduleHide();
                break;
            }
        }
    });

    // ============ 初始化 ============

    function init() {
        injectAntiBypass();

        // 初始隐藏
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', hideAdElements);
        } else {
            hideAdElements();
        }

        // 监听动态内容
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
    }

    init();

    // ============ 与 Service Worker 通信 ============

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'HIDE_ELEMENTS') {
            hideAdElements();
            sendResponse({ ok: true });
        }
        return true;
    });

    console.log('DewSecure Content Script 已加载');
})();
