// ============================================================================
// A3 修复：拦截 fetch / XHR / sendBeacon / WebSocket / 原生表单的跨域密码外传
// B-1/B-2 修复：精准 eTLD+1 判定，异步解析 Request/Blob 体
// ============================================================================
import { getDomain } from 'tldts';

(function() {
    'use strict';
    if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost') return;

    // 🛡️ B-1 修复：使用 tldts 获取真实的注册域 (eTLD+1)，处理 co.uk / github.io
    const getSite = (hostname) => {
        try {
            return getDomain(hostname, { allowPrivateDomains: true }) || hostname;
        } catch(e) {
            return hostname;
        }
    };

    function showLeakWarning(targetHost) {
        if (document.getElementById('dewsecure-leak-warning')) return;
        const banner = document.createElement('div');
        banner.id = 'dewsecure-leak-warning';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#dc2626;color:white;padding:12px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;display:flex;align-items:center;box-shadow:0 4px 6px rgba(0,0,0,0.3);';

        const dict = window.__dewsecureDict || {};
        const tTitle = dict['leak_title'] || 'Security Alert: DewSecure Blocked Data Leak';
        const tDesc = (dict['leak_desc'] || 'This page attempted to send your password to a third-party server ({host}), which has been blocked.').replace('{host}', targetHost);
        const tBtn = dict['leak_btn'] || 'Got it';

        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = 'flex: 1; display: flex; align-items: center; gap: 12px;';
        
        // 🛡️ 添加品牌图标
        const iconSvg = document.createElement('div');
        iconSvg.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>';
        iconSvg.style.cssText = 'display: flex; flex-shrink: 0; color: white;';
        contentDiv.appendChild(iconSvg.firstChild);

        const textDiv = document.createElement('div');
        textDiv.style.cssText = 'text-align: left;';
        const titleStrong = document.createElement('strong');
        titleStrong.textContent = tTitle;
        textDiv.appendChild(titleStrong);
        const descDiv = document.createElement('div');
        descDiv.style.cssText = 'font-size: 12px; opacity: 0.9; margin-top: 4px;';
        descDiv.textContent = tDesc;
        textDiv.appendChild(descDiv);
        
        contentDiv.appendChild(textDiv);

        const btn = document.createElement('button');
        btn.id = 'dewsecure-leak-ignore';
        btn.style.cssText = 'background: transparent; border: 1px solid white; color: white; padding: 6px 16px; border-radius: 4px; cursor: pointer; white-space: nowrap; font-size: 13px;';
        btn.textContent = tBtn;

        banner.appendChild(contentDiv);
        banner.appendChild(btn);
        (document.body || document.documentElement).appendChild(banner);
        btn.addEventListener('click', () => banner.remove());
    }

    // 🛡️ B-2 修复：异步提取 Body 文本
    async function bodyText(body) {
        if (body == null) return '';
        if (typeof body === 'string') return body;
        if (body instanceof URLSearchParams) return body.toString();
        if (body instanceof FormData) {
            let s = '';
            for (const [k, v] of body.entries()) s += k + '=' + (typeof v === 'string' ? v : '') + '&';
            return s;
        }
        if (body instanceof Blob) {
            return body.size < 1_000_000 ? await body.text().catch(() => '') : '';
        }
        if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
            return new TextDecoder().decode(body);
        }
        // 处理 Request 对象内部的 body 读取返回的 Promise
        if (body && typeof body.then === 'function') {
            try {
                const text = await body;
                return typeof text === 'string' ? text : '';
            } catch(e) { return ''; }
        }
        return '';
    }

    async function isCredentialLeak(url, body) {
        if (!url) return false;
        try {
            const target = new URL(String(url), location.href);
            // 🛡️ B-1 修复：精准判定同站
            if (getSite(target.hostname) === getSite(location.hostname)) return false;

            const pws = Array.from(document.querySelectorAll('input[type="password"]')).map(i => i.value).filter(v => v && v.length >= 4);
            if (pws.length === 0) return false;

            // 🛡️ B-2 修复：await 异步提取
            const text = await bodyText(body);
            if (!text) {
                console.warn('[DewSecure] ⚠️ bodyText 解析为空，无法检测内容');
                return false;
            }

            for (const pw of pws) {
                if (text.includes(pw) || text.includes(encodeURIComponent(pw))) {
                    console.warn('[DewSecure] 🚨 拦截到跨域密码外传! 目标:', target.hostname);
                    showLeakWarning(target.hostname);
                    return true;
                }
            }
        } catch (e) {
            console.error('[DewSecure] isCredentialLeak 异常:', e);
        }
        return false;
    }

    // 1. Hook fetch (支持 Request 对象深度解析)
    const nativeFetch = window.fetch;
    if (nativeFetch) {
        window.fetch = async function(input, init) {
            const req = input instanceof Request ? input : null;
            let url = req ? req.url : String(input);
            let body = init && init.body !== undefined ? init.body : null;

            if (body == null && req && req.method !== 'GET' && req.method !== 'HEAD') {
                try { body = req.clone().text(); } catch (_) {}
            }

            if (await isCredentialLeak(url, body)) {
                console.warn('[DewSecure] 🛑 拦截 Fetch 请求:', url);
                return Promise.reject(new TypeError('DewSecure: Blocked cross-origin credential transmission'));
            }
            return nativeFetch.apply(this, arguments);
        };
    }

    // 2. Hook XMLHttpRequest
    const nativeXHROpen = XMLHttpRequest.prototype.open;
    const nativeXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.__dw_url = url;
        return nativeXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
        // 同步抓取密码快照
        if (body && typeof body === 'string') {
            const pws = Array.from(document.querySelectorAll('input[type="password"]')).map(i => i.value).filter(v => v && v.length >= 4);
            if (pws.length > 0) {
                const targetUrl = this.__dw_url;
                isCredentialLeak(targetUrl, body).then(isLeak => {
                    if (isLeak) {
                        this.abort(); // 如果异步检查发现泄露，强制中断
                    }
                });
            }
        }
        return nativeXHRSend.apply(this, arguments);
    };

    // 3. Hook sendBeacon
    const nativeBeacon = navigator.sendBeacon;
    if (nativeBeacon) {
        navigator.sendBeacon = function(url, data) {
            // Beacon 无法拦截请求，只能同步判断
            const pws = Array.from(document.querySelectorAll('input[type="password"]')).map(i => i.value).filter(v => v && v.length >= 4);
            if (pws.length > 0 && (typeof data === 'string' || data instanceof URLSearchParams || data instanceof FormData)) {
                let bodyStr = '';
                if (typeof data === 'string') bodyStr = data;
                else if (data instanceof URLSearchParams) bodyStr = data.toString();
                else if (data instanceof FormData) for (let [k,v] of data.entries()) bodyStr += k+'='+v+'&';
                
                const target = new URL(String(url), location.href);
                if (getSite(target.hostname) !== getSite(location.hostname) && pws.some(pw => bodyStr.includes(pw))) {
                    showLeakWarning(target.hostname);
                    return false;
                }
            }
            return nativeBeacon.apply(this, arguments);
        };
    }

    // 4. 🛡️ B-2 新增：Hook WebSocket.send
    if (window.WebSocket) {
        const nativeWsSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function(data) {
            if (typeof data === 'string') {
                const pws = Array.from(document.querySelectorAll('input[type="password"]')).map(i => i.value).filter(v => v && v.length >= 4);
                if (pws.length > 0) {
                    // 注意：WebSocket url 是 ws:// 或 wss://
                    const targetUrl = this.url.replace(/^ws/, 'http');
                    try {
                        const target = new URL(targetUrl);
                        if (getSite(target.hostname) !== getSite(location.hostname) && pws.some(pw => data.includes(pw))) {
                            showLeakWarning(target.hostname);
                            this.close();
                            throw new Error('DewSecure: Blocked cross-origin credential transmission via WebSocket');
                        }
                    } catch(e) {}
                }
            }
            return nativeWsSend.apply(this, arguments);
        };
    }

    // 5. 🛡️ B-2 新增：Hook 原生表单提交 (绕过 submit 事件的情况)
    const nativeFormSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
        const pw = this.querySelector('input[type="password"]');
        if (pw && pw.value) {
            const t = new URL(this.action || location.href, location.href);
            if (getSite(t.hostname) !== getSite(location.hostname)) {
                console.warn('[DewSecure] 🚨 拦截到原生表单跨域提交:', t.hostname);
                showLeakWarning(t.hostname);
                return; // 阻断
            }
        }
        return nativeFormSubmit.apply(this, arguments);
    };

    // 监听常规 submit 事件
    document.addEventListener('submit', e => {
        const f = e.target;
        if (!(f instanceof HTMLFormElement)) return;
        const pw = f.querySelector('input[type="password"]');
        if (!pw || !pw.value) return;
        const t = new URL(f.action || location.href, location.href);
        if (getSite(t.hostname) !== getSite(location.hostname)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            showLeakWarning(t.hostname);
        }
    }, true);
})();
