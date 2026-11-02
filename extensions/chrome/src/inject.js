(function() {
    // 🔒 F-03: 主世界无法调用 chrome.runtime，完全依赖 content.js 通过 postMessage 传递 DEWSECURE_PAUSE 信号


// ===== 🌟 白名单热更新接管 =====
let isPaused = false;
// 备份原生方法
const nativeWindowOpen = window.open;
const nativeLocationAssign = window.location.assign;

let dwSettings = { antiHijackEnabled: true, antiBypassEnabled: true, blockSocialTrackers: true };
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'DEWSECURE_PAUSE') {
        isPaused = true;
        window.open = nativeWindowOpen;
        console.log('🛡️ [DewSecure Inject] 主世界已挂起，恢复原生 API');
    }
    // 🔒 F2 修复：接收真实的设置状态
    if (e.data && e.data.type === 'DEWSECURE_SETTINGS') {
        dwSettings = e.data.settings || {};
    }
});

// 包装原本的拦截逻辑
// 移除早期冗余且会导致双倍弹窗的 window.open 包装，统一在下方处理

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
        if (!document.documentElement) return false;
        return document.documentElement.getAttribute('data-dewsecure-paused') === 'true';
    }

    const adPatterns = /(mmp_pid=|Allianceid=|from_affiliate=|affiliate_id=|uls_trackid=|utm_source=|aid=api%7C|1xlite|1xbet|omguk|tiktok\.com\/view|doubleclick|googlesyndication|propellerads|adsterra|a_aid=|a_bid=|gsid=|gsc=|track=|affiliate=|click_id=|sub_id=)/i;
    const isAdUrl = (url) => url && typeof url === 'string' && adPatterns.test(url);

    const _windowOpen = window.open;
    const _locationAssign = window.location.assign;
    const _locationReplace = window.location.replace;
    const _anchorClick = HTMLAnchorElement.prototype.click;
    const _formSubmit = HTMLFormElement.prototype.submit;

    // 0. 拦截系统通知请求 (图2 tiket.com 的原因)
    try {
        if (window.Notification) {
            const _requestPermission = window.Notification.requestPermission;
            window.Notification.requestPermission = function(callback) {
                if (!isPaused() && dwSettings.antiHijackEnabled !== false) {
                    console.log('🛡️ [DewSecure] 已拦截系统通知请求');
                    if (callback) callback('denied');
                    return Promise.resolve('denied');
                }
                return _requestPermission.apply(this, arguments);
            };
        }
    } catch(e) {}

    // 1. window.open (修复双倍弹窗与不可配置问题)
    try {
        const _windowOpen = window.open;
        // 伪装原生代码，防止被网页检测出 Hook
        const nativeOpenStr = _windowOpen.toString();

        const hookedOpen = function(url, target, features) {
            if (!isPaused() && isAdUrl(url)) {
                // AdGuard 策略：如果没有用户真实交互（自动弹窗），直接抛弃
                if (window.navigator && window.navigator.userActivation && !window.navigator.userActivation.isActive) {
                    console.warn('🛡️ [DewSecure] 零闪烁拦截自动弹窗:', url);
                    return null; 
                }
            }
            return _windowOpen.apply(this, arguments);
        };

        // 伪装 toString
        hookedOpen.toString = function() { return nativeOpenStr; };

        // 使用 defineProperty 防止被覆盖或删除
        Object.defineProperty(window, 'open', {
            get: function() { return hookedOpen; },
            set: function() { /* 劫持赋值，保持静默 */ },
            configurable: false,
            enumerable: true
        });
    } catch (e) {
        // 降级策略：如果 defineProperty 失败，回退到普通赋值
        try {
            window.open = function(url, target, features) {
                if (!isPaused() && isAdUrl(url) && window.navigator?.userActivation?.isActive === false) {
                    return null;
                }
                return window.open.apply(this, arguments);
            };
        } catch(err) {}
    }

    // 2. location 跳转 (🛡️ F-07 修复：Chrome 禁止覆盖 location.assign/replace，直接移除)

    // 3. A 标签点击
    try {
        HTMLAnchorElement.prototype.click = function() {
            if (!isPaused() && isAdUrl(this.href)) return;
            _anchorClick.apply(this, arguments);
        };
    } catch (e) {}

    // 4. Form 提交
    try {
        HTMLFormElement.prototype.submit = function() {
            if (!isPaused() && isAdUrl(this.action)) return;
            _formSubmit.apply(this, arguments);
        };
    } catch (e) {}

    // 5. 反反拦截欺骗 (只在开启时生效)
    {
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
            if (!isPaused() && target.tagName === 'A' && target.href && isAdUrl(target.href)) {
                e.preventDefault(); e.stopImmediatePropagation();
            }
            if (!isPaused() && target.tagName === 'FORM' && target.action && isAdUrl(target.action)) {
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
                    if (node.className && typeof node.className === 'string' && /(^ad-slot|^ad-banner|^ad-wrapper|^ad-container|^adsbygoogle|^sponsored-ad|^advertisement)/i.test(node.className)) {
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