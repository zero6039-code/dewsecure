(function() {
    // 🛡️ B-9 终极防御：全局 toString 劫持，防止 nativeToString 穿透
    const hookedFns = new WeakSet();
    const nativeToString = Function.prototype.toString;
    
    Function.prototype.toString = function() {
        if (hookedFns.has(this)) {
            return `function ${this.name || ''}() { [native code] }`;
        }
        return nativeToString.call(this);
    };
    
    // 伪装 toString 自身
    Object.defineProperty(Function.prototype.toString, 'toString', {
        value: function() { return 'function toString() { [native code] }'; },
        writable: false, configurable: false
    });

    // F-03: 主世界无法调用 chrome.runtime，完全依赖 content.js 通过 postMessage 传递 DEWSECURE_PAUSE 信号

    // A2 修复（inject 侧）：暂停状态只由扩展消息设置，不再读取页面可写的 DOM 属性
    let pausedByExtension = false;
    const nativeWindowOpen = window.open;
    const nativeLocationAssign = window.location.assign;

    let dwSettings = { antiHijackEnabled: true, antiBypassEnabled: true, blockSocialTrackers: true };
    
    // 🛡️ B-4 修复：使用 MessageChannel 建立私有通道
    let port = null;
    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const targetOrigin = location.origin === 'null' ? '*' : location.origin;
        if (e.origin !== targetOrigin && targetOrigin !== '*') return;
        if (!e.data) return;

        // 🛡️ 修复：直接接收来自 content.js 的语言包字典
        if (e.data.type === 'DEWSECURE_I18N' && e.data.dict) {
            console.log(`🛡️ [DewSecure Inject] 主世界成功接收字典 (Keys: ${Object.keys(e.data.dict).length})`);
            window.__dewsecureDict = e.data.dict;
        }

        // 从隔离世界接收通信端口
        if (e.data.type === 'DEWSECURE_PORT_INIT' && !port && e.ports && e.ports[0]) {
            e.stopImmediatePropagation(); // 阻止页面偷听
            port = e.ports[0];
            port.onmessage = (msg) => {
                if (msg.data?.type === 'DEWSECURE_PAUSE') {
                    pausedByExtension = true;
                    try {
                        Object.defineProperty(window, 'open', { value: nativeWindowOpen, writable: true, configurable: true });
                    } catch (err) {
                        try { window.open = nativeWindowOpen; } catch (_) {}
                    }
                    console.log('[DewSecure Inject] 主世界已挂起，恢复原生 API');
                }
                if (msg.data?.type === 'DEWSECURE_SETTINGS') {
                    dwSettings = msg.data.settings || {};
                }
                if (msg.data?.type === 'DEWSECURE_I18N') {
                    window.__dewsecureDict = msg.data.dict || {};
                }
            };
        }
    }, true); // 使用捕获阶段确保优先接收

    // 通知隔离世界可以建立端口了（避免竞争）
    const hello = () => { if (!port) window.postMessage({ type: 'DEW_HELLO' }, '*'); };
    hello(); setTimeout(hello, 50); setTimeout(hello, 250);

    (function() {
        'use strict';
        if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return;
        }

        if (window.__dewsecureInjected) return;
        window.__dewsecureInjected = true;

        // A2 修复：不再读取 data-dewsecure-paused DOM 属性
        function isPaused() {
            return pausedByExtension;
        }

        // H-1 修复：只拦第三方广告主机或已知联盟参数
        const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|propellerads\.com|adsterra\.com|1xbet\.com|1xlite\.com|omguk\.com|omgt3\.com)$/i;
        const AFFILIATE_PARAMS = ['mmp_pid', 'Allianceid', 'uls_trackid', 'a_aid', 'a_bid', 'affiliate_id', 'from_affiliate', 'tag_aff_id', 'tag_aff_type'];

        const isAdUrl = (raw) => {
            if (dwSettings.antiHijackEnabled === false) return false;
            if (raw == null || raw === '') return false;
            try {
                const u = new URL(String(raw), location.href);
                if (u.origin === location.origin) return false;
                return AD_HOSTS.test(u.hostname) ||
                       AFFILIATE_PARAMS.some((p) => u.searchParams.has(p));
            } catch (_) {
                return false;
            }
        };

        const _locationAssign = window.location.assign;
        const _locationReplace = window.location.replace;
        const _anchorClick = HTMLAnchorElement.prototype.click;
        const _formSubmit = HTMLFormElement.prototype.submit;

        // 0. 拦截系统通知请求
        const NOTIFICATION_ALLOW_HOSTS = ['mail.google.com', 'calendar.google.com', 'outlook.live.com', 'outlook.office.com', 'web.whatsapp.com', 'web.telegram.org'];
        try {
            if (window.Notification) {
                const _requestPermission = window.Notification.requestPermission;
                const hookedRequestPermission = function(callback) {
                    const h = location.hostname;
                    const isAllowedHost = NOTIFICATION_ALLOW_HOSTS.some(d => h === d || h.endsWith('.' + d));
                    if (!isPaused() && dwSettings.antiHijackEnabled !== false && !isAllowedHost) {
                        console.log('[DewSecure] 已拦截系统通知请求');
                        if (callback) callback('denied');
                        return Promise.resolve('denied');
                    }
                    return _requestPermission.apply(this, arguments);
                };
                // 伪装 Notification
                try { hookedFns.add(hookedRequestPermission); } catch (e) {}
                window.Notification.requestPermission = hookedRequestPermission;
                // 🛡️ B-9 修复：伪装 toString 防止被页面检测
                hookedFns.add(window.Notification.requestPermission);
            }
        } catch(e) {}

        // 1. window.open (修复双倍弹窗与不可配置问题)
        try {
            const _windowOpen = window.open;
            const nativeOpenStr = _windowOpen.toString();
            const isSkidrow = window.location.hostname.includes('skidrowreloaded.com');

            const hookedOpen = function(url, target, features) {
                    if (!isPaused() && isSkidrow) {
                        if (url && !String(url).startsWith(location.origin) && !String(url).includes('skidrowreloaded.com')) {
                            console.warn('[DewSecure] 彻底封锁 Skidrow 跨域弹窗:', url);
                            if (port) port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                            else window.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' }, '*');
                            return null;
                        }
                    }
                    if (!isPaused() && isAdUrl(url)) {
                        console.warn('[DewSecure] 拦截恶意/劫持弹窗:', url);
                        if (port) port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                        else window.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' }, '*');
                        return null;
                    }
                    return _windowOpen.apply(this, arguments);
                };
                // 伪装 open
                try { hookedFns.add(hookedOpen); } catch (e) {}

                Object.defineProperty(window, 'open', {
                    get: function() { return hookedOpen; },
                    set: function() { },
                    configurable: true,
                    enumerable: true
                });
        } catch (e) {
            try {
                const _fallbackOpen = window.open;
                window.open = function(url, target, features) {
                    if (!isPaused() && isAdUrl(url) && window.navigator?.userActivation?.isActive === false) {
                        return null;
                    }
                    return _fallbackOpen.apply(this, arguments);
                };
            } catch(err) {}
        }

        // 3. A 标签点击
        try {
            const hookedClick = function() {
                    if (!isPaused()) {
                        if (isAdUrl(this.href)) return;
                        if (window.location.hostname.includes('skidrowreloaded.com') && this.href && !this.href.startsWith(location.origin) && !this.href.includes('skidrowreloaded.com')) {
                            console.warn('[DewSecure] 拦截 Skidrow 脚本强制点击跳转:', this.href);
                            return;
                        }
                        if (this.target && this.target !== '_self' && this.href && !this.href.startsWith(location.origin)) {
                            if (window.event && window.event.isTrusted) {
                                // 真实点击放行
                            } else {
                                console.warn('[DewSecure] 拦截脚本模拟的跨域弹窗:', this.href);
                                return;
                            }
                        }
                    }
                    _anchorClick.apply(this, arguments);
                };
                // 伪装 click
                try { hookedFns.add(hookedClick); } catch (e) {}
                HTMLAnchorElement.prototype.click = hookedClick;
            // 🛡️ B-9 修复：伪装 toString
            hookedFns.add(HTMLAnchorElement.prototype.click);
        } catch (e) {}

        // 4. Form 提交
        try {
            HTMLFormElement.prototype.submit = function() {
                if (!isPaused() && isAdUrl(this.action)) return;
                _formSubmit.apply(this, arguments);
            };
        } catch (e) {}

        // 5. 反反拦截欺骗
        if (!isPaused() && dwSettings.antiBypassEnabled !== false) {
            try {
                Object.defineProperty(window, 'adblock', { get: () => false, configurable: true });
                Object.defineProperty(window, 'canRunAds', { get: () => true, configurable: true });
            } catch(e) {}
        }

        // 6. Skidrow 弹窗劫持防护 (旧变量防护)
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

            // 🛡️ Skidrow 专项：拦截对空白区域、遮罩层的点击，防止底层脚本触发弹窗
            if (window.location.hostname.includes('skidrowreloaded.com') && !e.target.closest('a')) {
                if (e.target.id === 'dontfold' || e.target.tagName === 'BODY') {
                    if (e.target.id === 'dontfold') {
                        e.preventDefault(); e.stopImmediatePropagation();
                        return;
                    }
                }
            }

            if (target) {
                if (target.tagName === 'A' && target.href && isAdUrl(target.href)) {
                    e.preventDefault(); e.stopImmediatePropagation();
                    return;
                }
                if (target.tagName === 'FORM' && target.action && isAdUrl(target.action)) {
                    e.preventDefault(); e.stopImmediatePropagation();
                    return;
                }
                if (window.location.hostname.includes('skidrowreloaded.com')) {
                    if (target.tagName === 'A' && target.href && !target.href.startsWith(location.origin)) {
                        // 🛡️ 行为特征秒杀：在 Skidrow 上，只要是跨域 <a> 标签，不管是不是真实点击，只要想开新窗口或带追踪参数，全部封杀
                        const isTracking = AFFILIATE_PARAMS.some(p => target.href.includes(p)) || target.href.includes('utm_');
                        if ((target.target && target.target !== '_self') || e.ctrlKey || e.metaKey || isTracking) {
                            console.warn('[DewSecure] 根据行为特征彻底封杀恶意跳转:', target.href);
                            if (port) port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                          else window.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' }, '*');
                            e.preventDefault(); e.stopImmediatePropagation();
                        }
                    }
                }
            }
        };
        document.addEventListener('mousedown', interceptClick, true);
        document.addEventListener('click', interceptClick, true);

        // 8. DOM 节点清理
        const checkAndKillNode = (el) => {
            if (el.dataset.dwKilled) return;
            
            // 🛡️ 阻断 Skidrow 的点击劫持遮罩层
            if (window.location.hostname.includes('skidrowreloaded.com')) {
                if (el.id === 'dontfold' || (el.tagName === 'DIV' && el.style.position === 'fixed' && el.style.zIndex > 999)) {
                    console.warn('[DewSecure] 发现 Skidrow 点击劫持遮罩层，已拔除');
                    if (port) port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                          else window.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' }, '*');
                    el.remove();
                    return;
                }
            }
            if (el.tagName === 'A' && el.href && isAdUrl(el.href)) {
                if (port) port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                          else window.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' }, '*');
                el.removeAttribute('href'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
            } else if (el.tagName === 'FORM' && el.action && isAdUrl(el.action)) {
                el.removeAttribute('action'); el.style.setProperty('pointer-events', 'none', 'important'); el.dataset.dwKilled = 'true';
            } 
            // 🛡️ 行为特征秒杀：拦截全屏透明点击劫持
            else if (el.tagName === 'A' && el.href) {
                try {
                    const style = window.getComputedStyle(el);
                    // 如果是一个面积巨大、并且完全透明的链接（典型点击劫持）
                    if (parseFloat(style.opacity) < 0.1 && 
                        (parseInt(style.width) > window.innerWidth * 0.5 || parseInt(style.height) > window.innerHeight * 0.5)) {
                        console.warn('[DewSecure] 检测到点击劫持(Clickjacking) 透明层，已摧毁:', el.href);
                        if (port) port.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' });
                          else window.postMessage({ type: 'DEWSECURE_STAT_INCREMENT' }, '*');
                        el.removeAttribute('href'); 
                        el.style.setProperty('pointer-events', 'none', 'important'); 
                        el.dataset.dwKilled = 'true';
                    }
                } catch (e) {}
            }
        };

        const killMaliciousNodes = (root) => {
            if (isPaused() || !root) return;
            if (root.nodeType === Node.ELEMENT_NODE) checkAndKillNode(root);
            const links = root.querySelectorAll ? root.querySelectorAll('a, form') : [];
            links.forEach(checkAndKillNode);
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

        const startObserver = () => {
            if (!document.documentElement) return;
            observer.observe(document.documentElement, { childList: true, subtree: true });
            killMaliciousNodes(document.documentElement);
        };

        if (document.documentElement) {
            startObserver();
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startObserver);
        } else {
            window.addEventListener('load', startObserver);
        }
    })();
})();
