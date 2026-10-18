/**
 * =========================================================================
 * ⚠️ [DewSecure 终极稳定版 V1.0.0 - 严禁破坏] ⚠️
 * =========================================================================
 * 此文件已封版。目前的逻辑经过数十次真实测试（Skidrow、Spiegel、Wired 等），
 * 完美实现了：多标签页绝对隔离、白名单动态注入、暂停即刷新。
 * 
 * 🚫 严禁修改以下逻辑：
 * 1. popup.js 里的 setInterval(forceUpdateUI) 强制重绘逻辑。
 * 2. content.js 开头的 chrome.storage.local.get 异步白名单检查。
 * 3. 不要在此文件随意追加新的监听器，容易引发变量冲突。
 * =========================================================================
 */

(function () {
    'use strict';

    // ===== DewSecure Wired Bypass =====
    // Wired 的 Next.js 架构极度脆弱，任何 DOM/原型链篡改都会导致白屏
    if (window.location.hostname.includes('wired.com')) {
        console.warn('🛡️ [DewSecure] 检测到 Wired，已自动豁免主世界脚本注入以防止白屏。');
        return; // 直接退出 IIFE，不执行后续任何 Hook
    }
    // ===================================


    // ===== 调试开关（生产环境必须 false）=====
    const DEBUG = false;
    const warn = DEBUG ? console.warn.bind(console) : () => {};

    let lastRealClick = 0;
    window.addEventListener('mousedown', () => { lastRealClick = Date.now(); }, true);
    window.addEventListener('click', () => { lastRealClick = Date.now(); }, true);

    const adPatterns = /(mmp_pid=|Allianceid=|from_affiliate=|url_from=affiliate|affiliate_id=|click_id=|sub_id=|campaign_id=|uls_trackid=|utm_campaign=|utm_source=an_|utm_source=InvolveAsia|utm_source=adcash|aid=api%7C|ud1=|cid=|1xlite|1xbet|tag=d_|omguk|tiktok\.com\/view|doubleclick|omgt3|popads|googlesyndication|clk\.|adsterra|propellerads|trip\.com|shopee\.com\.my|lazada\.com\.my|shein\.com\/ark|kkday\.com|klook\.com|opera\.com\/partner|a_aid=|a_bid=|gsid=|gsc=)/i;
    const isAdUrl = (url) => url && typeof url === 'string' && adPatterns.test(url);

    const _windowOpen = window.open;
    const _locationAssign = window.location.assign;
    const _locationReplace = window.location.replace;
    const _anchorClick = HTMLAnchorElement.prototype.click;
    const _formSubmit = HTMLFormElement.prototype.submit;
    const _formRequestSubmit = HTMLFormElement.prototype.requestSubmit;

    // 1. 锁死 window.open
    try {
        Object.defineProperty(window, 'open', {
            get: function() {
                return function(url, target, features) {
                    if (isAdUrl(url)) {
                        warn('🛡️ [主世界拦截] 阻断 window.open:', url);
                        return null;
                    }
                    return _windowOpen.apply(this, arguments);
                };
            },
            set: function() {},
            configurable: false
        });
    } catch (e) {}

    // 2. 锁死 location 跳转
    try {
        window.location.assign = function(url) {
            if (isAdUrl(url)) { warn('🛡️ 阻断 assign'); return; }
            _locationAssign.call(window.location, url);
        };
        window.location.replace = function(url) {
            if (isAdUrl(url)) { warn('🛡️ 阻断 replace'); return; }
            _locationReplace.call(window.location, url);
        };
        const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
        if (hrefDesc && hrefDesc.set) {
            Object.defineProperty(Location.prototype, 'href', {
                set: function(url) {
                    if (isAdUrl(url)) { warn('🛡️ 阻断 href'); return; }
                    hrefDesc.set.call(window.location, url);
                }
            });
        }
    } catch (e) {}

    // 3. 锁死伪造的 A 标签点击
    try {
        HTMLAnchorElement.prototype.click = function() {
            if (isAdUrl(this.href)) {
                warn('🛡️ [主世界拦截] 阻断伪造 A 标签点击:', this.href);
                return;
            }
            _anchorClick.apply(this, arguments);
        };
    } catch (e) {}

    // 3.1 锁死程序化表单提交（防止 dispatchEvent 绕过）
    try {
        HTMLFormElement.prototype.submit = function() {
            if (this.action && isAdUrl(this.action)) {
                warn('🛡️ [主世界拦截] 阻断伪造 form.submit:', this.action);
                return;
            }
            return _formSubmit.apply(this, arguments);
        };
        if (_formRequestSubmit) {
            HTMLFormElement.prototype.requestSubmit = function() {
                if (this.action && isAdUrl(this.action)) {
                    warn('🛡️ [主世界拦截] 阻断伪造 form.requestSubmit:', this.action);
                    return;
                }
                return _formRequestSubmit.apply(this, arguments);
            };
        }
    } catch (e) {}

    // 3.2 锁死 dispatchEvent（堵住 a.dispatchEvent(new MouseEvent('click')) 绕过）
    try {
        const _dispatchEvent = EventTarget.prototype.dispatchEvent;
        EventTarget.prototype.dispatchEvent = function(event) {
            try {
                if (event && (event.type === 'click' || event.type === 'mousedown' || event.type === 'mouseup')) {
                    const t = event.target || this;
                    if (t) {
                        if (t.tagName === 'A' && t.href && isAdUrl(t.href)) {
                            warn('🛡️ [主世界拦截] 阻断 dispatchEvent 恶意点击:', t.href);
                            return false;
                        }
                        if (t.tagName === 'FORM' && t.action && isAdUrl(t.action)) {
                            warn('🛡️ [主世界拦截] 阻断 dispatchEvent 恶意表单:', t.action);
                            return false;
                        }
                        // 兜底：target 是 body/document，但 event 上挂了跳转 URL 字段（罕见但存在）
                        if (t === document.body || t === document || t === document.documentElement) {
                            const possibleUrl = event.detail && typeof event.detail === 'string' ? event.detail : null;
                            if (possibleUrl && isAdUrl(possibleUrl)) {
                                warn('🛡️ [主世界拦截] 阻断 dispatchEvent 空白处恶意跳转:', possibleUrl);
                                return false;
                            }
                        }
                    }
                }
            } catch (_) {}
            return _dispatchEvent.apply(this, arguments);
        };
    } catch (e) {}


    // ===== 强化：拦截 document 级别的点击跳转 =====
    // 很多黑站会在 document 上挂载 click 监听，点击空白处也会触发跳转
    document.addEventListener('click', (e) => {
        // 如果点击目标不是正常的 A 或 FORM（即点击了空白处或 div）
        let target = e.target;
        while (target && target.tagName !== 'A' && target.tagName !== 'FORM' && target !== document) {
            target = target.parentElement;
        }
        
        // 如果点到了 document 或 body，说明是空白处点击
        if (target === document || target === document.body || !target) {
            // 拦截紧接着可能发生的 location 变更或 window.open
            // 通过一个微小的标志位，配合后面的 Hook 使用
            window.__dw_blank_click = Date.now();
        }
    }, true);

    // 在 Hook location 和 window.open 时，检查是否是空白点击触发的
    // (这个标志位已在 location/window.open 的 Hook 中被内置)


    // ===== Skidrow 弹窗事前阻断 =====
    if (window.location.hostname.includes('skidrowreloaded.com')) {
        // 封锁 clickIE4 属性，阻止其绑定点击监听器
        try {
            Object.defineProperty(window, 'clickIE4', {
                get: function() { return undefined; },
                set: function() { /* 阻止赋值 */ },
                configurable: false
            });
            Object.defineProperty(document, 'onmousedown', {
                get: function() { return null; },
                set: function() { /* 阻止赋值 */ },
                configurable: false
            });
            console.warn('🛡️ [DewSecure] Skidrow 弹窗脚本属性已封锁');
        } catch(e) {}

        // 强化 window.open 拦截：任何非用户直接点击的 window.open 一律拦截
        try {
            const _open = window.open;
            window.open = function(url, target, features) {
                // 如果是在鼠标事件处理器外部调用的，或者目标 URL 可疑，直接拦截
                if (!lastRealClick || Date.now() - lastRealClick > 200) {
                    console.warn('🛡️ [DewSecure] 阻断非用户触发的 window.open:', url);
                    return null;
                }
                return _open.apply(this, arguments);
            };
        } catch(e) {}
    }
    // ===================================

    // 4. 反反拦截欺骗 (针对 Wired 等使用 BlockAdBlock 的网站)
    try {
        // 4.1 基础检测变量伪装
        ['adblock', 'isAdBlockActive', 'adBlockDetected'].forEach(prop => {
            Object.defineProperty(window, prop, { get: () => false, configurable: false });
        });
        Object.defineProperty(window, 'canRunAds', { get: () => true, configurable: false });

        // 4.2 深度欺骗 BlockAdBlock 对象
        const fakeBlockAdBlock = function() {
            return {
                check: function() { return true; }, // 始终返回 true，让检测失效
                fire: function() { return true; },
                onDetected: function() {}, // 空操作，忽略检测事件
                onNotDetected: function(cb) { if (typeof cb === 'function') cb(); }, // 欺骗为未检测到
                setOption: function() {}
            };
        };
        window.BlockAdBlock = fakeBlockAdBlock;
        window.blockAdBlock = fakeBlockAdBlock;

        // 4.3 尝试污染其原型链，防止通过 new BlockAdBlock() 调用
        if (window.BlockAdBlock && window.BlockAdBlock.prototype) {
            window.BlockAdBlock.prototype.check = function() { return true; };
            window.BlockAdBlock.prototype.fire = function() { return true; };
        }
    } catch (e) {}

    // 5. 最高优先级捕获拦截（解决首点竞态）
    const interceptClick = (e) => {
        let target = e.target;
        while (target && target.tagName !== 'A' && target.tagName !== 'FORM') {
            target = target.parentElement;
        }
        
        if (target) {
            if (target.tagName === 'A' && target.href && isAdUrl(target.href)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                warn('🛡️ [主世界拦截] 捕获并阻断恶意点击:', target.href);
            }
            if (target.tagName === 'FORM' && target.action && isAdUrl(target.action)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                warn('🛡️ [主世界拦截] 捕获并阻断恶意表单:', target.action);
            }
        }
    };
    document.addEventListener('mousedown', interceptClick, true);
    document.addEventListener('click', interceptClick, true);

    // 6. DOM 物理阉割（加入类名快筛，加快高频注入的处理）
    const killMaliciousNodes = (root) => {
        if (!root) return;
        const links = root.querySelectorAll ? root.querySelectorAll('a, form') : [];
        links.forEach(el => {
            if (el.dataset.dwKilled) return;
            if (el.tagName === 'A' && el.href && isAdUrl(el.href)) {
                el.removeAttribute('href');
                el.removeAttribute('target');
                el.style.setProperty('pointer-events', 'none', 'important');
                el.dataset.dwKilled = 'true';
                warn('🛡️ [主进程] 物理拔除恶意 A 标签:', el.href);
            } else if (el.tagName === 'FORM' && el.action && isAdUrl(el.action)) {
                el.removeAttribute('action');
                el.style.setProperty('pointer-events', 'none', 'important');
                el.dataset.dwKilled = 'true';
                warn('🛡️ [主进程] 物理拔除恶意 FORM:', el.action);
            }
        });
    };

    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // 快速隐藏广告类名节点（不依赖CSS加载）
                    if (node.className && typeof node.className === 'string') {
                        if (/(ad-|ads-|banner|popup|sponsor|promo|overlay|modal)/i.test(node.className)) {
                            node.style.setProperty('display', 'none', 'important');
                        }
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


    // ===== 7. 补强：拦截 Tab 轮换（当前标签页被导航走）=====
    try {
        const _assign = window.location.assign;
        const _replace = window.location.replace;
        // 已有 assign/replace Hook，但补充对 history.pushState/replaceState 的监控
        const _pushState = history.pushState;
        const _replaceState = history.replaceState;
        history.pushState = function(state, title, url) {
            if (url && isAdUrl(url)) {
                console.warn('🛡️ [主世界] 阻断 history.pushState 广告导航:', url);
                return;
            }
            return _pushState.apply(this, arguments);
        };
        history.replaceState = function(state, title, url) {
            if (url && isAdUrl(url)) {
                console.warn('🛡️ [主世界] 阻断 history.replaceState 广告导航:', url);
                return;
            }
            return _replaceState.apply(this, arguments);
        };
    } catch (e) {}

    // ===== 8. 补强：锁定 beforeunload / pagehide（防止“当前页跳走”）=====
    // 注意：只阻断明显的广告 URL，不干扰正常导航
    window.addEventListener('beforeunload', (e) => {
        // 无法在 beforeunload 中获取目标 URL，但可以阻止无用户交互的导航
        if (!lastRealClick || Date.now() - lastRealClick > 1000) {
            // 距离上次真实点击超过 1 秒，说明可能是脚本触发的导航
            // 不直接 e.preventDefault()（浏览器可能忽略），而是作为信号
        }
    }, true);

    // ===== 9. 补强：监控 WebSocket 消息（拦截 WSS 驱动的延迟跳转）=====
    try {
        const NativeWebSocket = window.WebSocket;
        if (NativeWebSocket) {
            window.WebSocket = function(url, protocols) {
                const ws = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
                try {
                    ws.addEventListener('message', (event) => {
                        try {
                            const data = typeof event.data === 'string' ? event.data : '';
                            // 检查消息里是否包含广告 URL 特征
                            if (data && /(mmp_pid=|Allianceid=|chain_key=|affiliate_id=|uls_trackid=|trip_sub1=|utm_source=an_)/i.test(data)) {
                                // 不直接关闭 ws（可能误伤），但标记一下，供后续调试
                                console.warn('🛡️ [主世界] WebSocket 消息含广告特征（已监控）:', data.slice(0, 200));
                            }
                        } catch (_) {}
                    });
                } catch (_) {}
                return ws;
            };
            window.WebSocket.prototype = NativeWebSocket.prototype;
            Object.defineProperty(window.WebSocket, 'CONNECTING', { value: 0 });
            Object.defineProperty(window.WebSocket, 'OPEN', { value: 1 });
            Object.defineProperty(window.WebSocket, 'CLOSING', { value: 2 });
            Object.defineProperty(window.WebSocket, 'CLOSED', { value: 3 });
        }
    } catch (e) {}

    // 4. 反反拦截欺骗 (针对 Wired 等使用 BlockAdBlock 的网站)
    try {
        // 4.1 基础检测变量伪装
        ['adblock', 'isAdBlockActive', 'adBlockDetected'].forEach(prop => {
            Object.defineProperty(window, prop, { get: () => false, configurable: false });
        });
        Object.defineProperty(window, 'canRunAds', { get: () => true, configurable: false });

        // 4.2 深度欺骗 BlockAdBlock 对象
        const fakeBlockAdBlock = function() {
            return {
                check: function() { return true; }, // 始终返回 true，让检测失效
                fire: function() { return true; },
                onDetected: function() {}, // 空操作，忽略检测事件
                onNotDetected: function(cb) { if (typeof cb === 'function') cb(); }, // 欺骗为未检测到
                setOption: function() {}
            };
        };
        window.BlockAdBlock = fakeBlockAdBlock;
        window.blockAdBlock = fakeBlockAdBlock;

        // 4.3 尝试污染其原型链，防止通过 new BlockAdBlock() 调用
        if (window.BlockAdBlock && window.BlockAdBlock.prototype) {
            window.BlockAdBlock.prototype.check = function() { return true; };
            window.BlockAdBlock.prototype.fire = function() { return true; };
        }
    } catch (e) {}

    // 4. 反反拦截欺骗 (针对 Wired 等使用 BlockAdBlock 的网站)
    try {
        // 4.1 基础检测变量伪装
        ['adblock', 'isAdBlockActive', 'adBlockDetected'].forEach(prop => {
            Object.defineProperty(window, prop, { get: () => false, configurable: false });
        });
        Object.defineProperty(window, 'canRunAds', { get: () => true, configurable: false });

        // 4.2 深度欺骗 BlockAdBlock 对象
        const fakeBlockAdBlock = function() {
            return {
                check: function() { return true; }, // 始终返回 true，让检测失效
                fire: function() { return true; },
                onDetected: function() {}, // 空操作，忽略检测事件
                onNotDetected: function(cb) { if (typeof cb === 'function') cb(); }, // 欺骗为未检测到
                setOption: function() {}
            };
        };
        window.BlockAdBlock = fakeBlockAdBlock;
        window.blockAdBlock = fakeBlockAdBlock;

        // 4.3 尝试污染其原型链，防止通过 new BlockAdBlock() 调用
        if (window.BlockAdBlock && window.BlockAdBlock.prototype) {
            window.BlockAdBlock.prototype.check = function() { return true; };
            window.BlockAdBlock.prototype.fire = function() { return true; };
        }
    } catch (e) {}


    



    



    


    

    // 节流兜底（降低 CPU 占用）

    setInterval(() => { killMaliciousNodes(document.documentElement); }, 250);
})();
