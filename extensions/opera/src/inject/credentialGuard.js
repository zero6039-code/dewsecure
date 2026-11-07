// ============================================================================
// A3 修复：拦截 fetch / XHR / sendBeacon 的跨域密码外传
// ============================================================================
(function() {
    'use strict';
    if (window.location.hostname === 'dewsecure.com' || window.location.hostname === 'localhost') return;

    // 简单的取根域方法
    const getBase = h => {
        if (!h) return '';
        const parts = h.split('.');
        return parts.length > 2 ? parts.slice(-2).join('.') : h;
    };

    function showLeakWarning(targetHost) {
        if (document.getElementById('dewsecure-leak-warning')) return;
        const banner = document.createElement('div');
        banner.id = 'dewsecure-leak-warning';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#dc2626;color:white;padding:12px 20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;display:flex;align-items:center;box-shadow:0 4px 6px rgba(0,0,0,0.3);';
        
        // 接入多语言字典
        const tTitle = window.__dewsecureDict['leak_title'] || 'Security Alert: DewSecure Blocked Data Leak';
        const tDesc = (window.__dewsecureDict['leak_desc'] || 'This page attempted to send your password to a third-party server ({host}).').replace('{host}', targetHost);
        const tBtn = window.__dewsecureDict['leak_btn'] || 'Got it';

        // 🛡️ C3 修复：使用安全 DOM 操作
        const contentDiv = document.createElement('div');
        contentDiv.style.cssText = 'flex: 1; text-align: center; padding-right: 20px;';
        
        const titleStrong = document.createElement('strong');
        titleStrong.textContent = '🚨 ' + tTitle;
        contentDiv.appendChild(titleStrong);
        
        const descDiv = document.createElement('div');
        descDiv.style.cssText = 'font-size: 12px; opacity: 0.9; margin-top: 4px;';
        descDiv.textContent = tDesc;
        contentDiv.appendChild(descDiv);

        const btn = document.createElement('button');
        btn.id = 'dewsecure-leak-ignore';
        btn.style.cssText = 'background: transparent; border: 1px solid white; color: white; padding: 6px 16px; border-radius: 4px; cursor: pointer; white-space: nowrap; font-size: 13px;';
        btn.textContent = tBtn;

        banner.appendChild(contentDiv);
        banner.appendChild(btn);
        document.body ? document.body.appendChild(banner) : document.documentElement.appendChild(banner);
        
        document.getElementById('dewsecure-leak-ignore').addEventListener('click', () => banner.remove());
    }

    // 核心检测逻辑
    function isCredentialLeak(url, body) {
        if (!url || !body) return false;
        try {
            const target = new URL(String(url), location.href);
            // 同域不拦（允许正常的登录）
            if (getBase(target.hostname) === getBase(location.hostname)) return false;
            
            // 获取当前页面所有的密码值（长度大于 3 的才算有效密码）
            const pws = Array.from(document.querySelectorAll('input[type="password"]')).map(i => i.value).filter(v => v && v.length >= 4);
            if (pws.length === 0) return false;

            let bodyStr = '';
            if (typeof body === 'string') {
                bodyStr = body;
            } else if (body instanceof URLSearchParams) {
                bodyStr = body.toString();
            } else if (body instanceof FormData) {
                for (let [k, v] of body.entries()) bodyStr += k + '=' + String(v) + '&';
            } else {
                return false; // 暂不解析 Blob 等复杂二进制数据，避免影响性能
            }

            // 检查请求体中是否包含真实的密码
            for (const pw of pws) {
                if (bodyStr.includes(pw)) {
                    console.warn('[DewSecure] 🚨 拦截到跨域密码外传! 目标:', target.hostname);
                    showLeakWarning(target.hostname);
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    // 1. Hook fetch
    const nativeFetch = window.fetch;
    if (nativeFetch) {
        window.fetch = function(input, init) {
            let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
            let body = init && init.body ? init.body : (input instanceof Request ? null : null);
            
            // 处理 Request 对象中的 body（如果有）
            if (input instanceof Request && !body) {
                try { body = input.clone().text(); } catch (_) {}
            }
            
            if (isCredentialLeak(url, body)) {
                return Promise.reject(new Error('DewSecure: Blocked cross-origin credential transmission'));
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
        if (isCredentialLeak(this.__dw_url, body)) {
            throw new Error('DewSecure: Blocked cross-origin credential transmission');
        }
        return nativeXHRSend.apply(this, arguments);
    };

    // 3. Hook sendBeacon
    const nativeBeacon = navigator.sendBeacon;
    if (nativeBeacon) {
        navigator.sendBeacon = function(url, data) {
            if (isCredentialLeak(url, data)) {
                return false;
            }
            return nativeBeacon.apply(this, arguments);
        };
    }
})();
