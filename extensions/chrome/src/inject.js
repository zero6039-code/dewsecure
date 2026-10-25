(async function() {
    const host = window.location.hostname;
    try {
        const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        if (settings) {
            const m = d => host === d || host.endsWith('.' + d);
            if ((settings.whitelist || []).some(m) || (settings.tempWhitelist || []).some(m)) {
                console.warn('🛡️ [DewSecure Inject] 命中白名单，已停止主世界 Hook。');
                return; // 停止执行下方的 Hook 代码
            }
        }
    } catch(e) {}


// ===== 🌟 白名单热更新接管 =====
let isPaused = false;
// 备份原生方法
const nativeWindowOpen = window.open;
const nativeLocationAssign = window.location.assign;

window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'DEWSECURE_PAUSE') {
        isPaused = true;
        // 恢复原生 window.open
        window.open = nativeWindowOpen;
        console.log('🛡️ [DewSecure Inject] 主世界已挂起，恢复原生 API');
    }
});

// 包装原本的拦截逻辑
const originalOpen = window.open;
window.open = function(...args) {
    if (isPaused) return nativeWindowOpen.apply(this, args);
    return originalOpen.apply(this, args);
};

(function() {
    'use strict';
    // 🌟 官网与本地开发环境白名单（彻底解决 F12 卡死）
    if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return;
    }

    if (window.__dewsecureInjected) return;
    window.__dewsecureInjected = true;

    // 每个 Hook 执行前检查是否暂停
    function isPaused() {
        return document.documentElement.getAttribute('data-dewsecure-paused') === 'true';
    }

    const adPatterns = /(mmp_pid=|Allianceid=|from_affiliate=|url_from=affiliate|affiliate_id=|click_id=|sub_id=|campaign_id=|uls_trackid=|utm_campaign=|utm_source=an_|utm_source=InvolveAsia|utm_source=adcash|aid=api%7C|ud1=|cid=|1xlite|1xbet|tag=d_|omguk|tiktok\.com\/view|doubleclick|omgt3|popads|googlesyndication|clk\.|adsterra|propellerads|trip\.com|shopee\.com\.my|lazada\.com\.my|shein\.com\/ark|kkday\.com|klook\.com|opera\.com\/partner|a_aid=|a_bid=|gsid=|gsc=)/i;
    const isAdUrl = (url) => url && typeof url === 'string' && adPatterns.test(url);

    const _windowOpen = window.open;
    const _locationAssign = window.location.assign;
    const _locationReplace = window.location.replace;
    const _anchorClick = HTMLAnchorElement.prototype.click;
    const _formSubmit = HTMLFormElement.prototype.submit;

    // 1. window.open
    try {
        Object.defineProperty(window, 'open', {
            get: function() {
                return function(url, target, features) {
                    if (isPaused()) return _windowOpen.apply(this, arguments);
                    if (isAdUrl(url)) return null;
                    return _windowOpen.apply(this, arguments);
                };
            },
            set: function() {}, configurable: false
        });
    } catch (e) {}

    // 2. location 跳转
    try {
        window.location.assign = function(url) {
            if (isPaused()) return _locationAssign.call(window.location, url);
            if (isAdUrl(url)) return;
            _locationAssign.call(window.location, url);
        };
        window.location.replace = function(url) {
            if (isPaused()) return _locationReplace.call(window.location, url);
            if (isAdUrl(url)) return;
            _locationReplace.call(window.location, url);
        };
    } catch (e) {}

    // 3. A 标签点击
    try {
        HTMLAnchorElement.prototype.click = function() {
            if (isPaused()) return _anchorClick.apply(this, arguments);
            if (isAdUrl(this.href)) return;
            _anchorClick.apply(this, arguments);
        };
    } catch (e) {}

    // 4. Form 提交
    try {
        HTMLFormElement.prototype.submit = function() {
            if (isPaused()) return _formSubmit.apply(this, arguments);
            if (isAdUrl(this.action)) return;
            _formSubmit.apply(this, arguments);
        };
    } catch (e) {}

    // 5. 反反拦截欺骗 (只在开启时生效)
    if (!isPaused()) {
        try {
            Object.defineProperty(window, 'adblock', { get: () => false });
            Object.defineProperty(window, 'canRunAds', { get: () => true });
        } catch(e) {}
    }

    // 6. Skidrow 弹窗劫持防护
    if (window.location.hostname.includes('skidrowreloaded.com') && !isPaused()) {
        try {
            Object.defineProperty(window, 'clickIE4', { get: () => undefined, set: () => {}, configurable: false });
        } catch(e) {}
    }

    // 7. 点击拦截捕获
    const interceptClick = (e) => {
        if (isPaused()) return;
        let target = e.target;
        while (target && target.tagName !== 'A' && target.tagName !== 'FORM') target = target.parentElement;
        if (target) {
            if (target.tagName === 'A' && target.href && isAdUrl(target.href)) {
                e.preventDefault(); e.stopImmediatePropagation();
            }
            if (target.tagName === 'FORM' && target.action && isAdUrl(target.action)) {
                e.preventDefault(); e.stopImmediatePropagation();
            }
        }
    };
    document.addEventListener('mousedown', interceptClick, true);
    document.addEventListener('click', interceptClick, true);

    // 8. DOM 节点清理
    const killMaliciousNodes = (root) => {
        if (isPaused() || !root) return;
        const links = root.querySelectorAll ? root.querySelectorAll('a, form') : [];
        links.forEach(el => {
            if (el.dataset.dwKilled) return;
            if (el.tagName === 'A' && el.href && isAdUrl(el.href)) {
                el.removeAttribute('href'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
            } else if (el.tagName === 'FORM' && el.action && isAdUrl(el.action)) {
                el.removeAttribute('action'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
            }
        });
    };

    const observer = new MutationObserver((mutations) => {
        if (isPaused()) return;
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.className && typeof node.className === 'string' && /(ad-|ads-|banner|popup|sponsor|promo|overlay|modal)/i.test(node.className)) {
                        node.style.setProperty('display', 'none', 'important');
                    }
                    killMaliciousNodes(node);
                }
            }
        }
    });
    if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        killMaliciousNodes(document.documentElement);
    }
})();
})();