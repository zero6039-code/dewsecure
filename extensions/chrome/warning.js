// 🌟 多语言引擎
async function applyI18n() {
    try {
        const storage = await chrome.storage.local.get('preferred_lang');
        let targetLang = storage.preferred_lang || 'en';
        if (targetLang === 'zh_CN') targetLang = 'zh';
        
        const url = chrome.runtime.getURL(`popup/locales/${targetLang}.json`);
        const res = await fetch(url);
        if (!res.ok) throw new Error('Lang not found');
        const data = await res.json();

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (data[key]) el.textContent = data[key];
        });
    } catch (e) {
        console.warn('[Warning Page] i18n load failed', e);
    }
}
applyI18n();

// 🌟 全局初始化
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('type');
    
    // 兼容 domain 和 url 参数
    let targetDomain = params.get('domain') || params.get('url');
    if (targetDomain === '\\0' || targetDomain === '%5C0') {
        targetDomain = 'Known Malicious Site';
    }
    
    // 解码域名
    const displayDomain = targetDomain ? decodeURIComponent(targetDomain) : 'Unknown Malicious Site';
    console.log('🛡️ [Warning] 解析到的真实域名:', displayDomain);

    // 延迟 100ms，等 i18n 渲染完后，强行覆盖所有 "Unknown URL"
    setTimeout(() => {
        const dangerUrlEl = document.getElementById('danger-url');
        if (dangerUrlEl) {
            dangerUrlEl.textContent = displayDomain;
            dangerUrlEl.removeAttribute('data-i18n'); // 防止被再次覆盖
        }

        // 兜底：扫描整个页面，只要文本是 Unknown URL，全部干掉
        document.querySelectorAll('div, span, p, h1, h2').forEach(el => {
            const txt = el.textContent.trim();
            if (txt === 'Unknown URL' || txt === 'Unknown Malicious Site' || txt === 'Loading...') {
                el.textContent = displayDomain;
                el.removeAttribute('data-i18n');
            }
        });
    }, 100);

    // 绑定真实按钮功能
    const btnClose = document.getElementById('btn-close');
    const btnContinue = document.getElementById('btn-continue');

    if (btnClose) {
        btnClose.onclick = () => {
            chrome.tabs.getCurrent(tab => {
                if (tab) chrome.tabs.remove(tab.id);
                else window.close();
            });
        };
    }

    if (btnContinue) {
        btnContinue.onclick = () => {
            if (targetDomain && targetDomain !== 'Known Malicious Site') {
                let pureDomain = targetDomain;
                try {
                    pureDomain = new URL(targetDomain.startsWith('http') ? targetDomain : `https://${targetDomain}`).hostname;
                } catch(e) {}

                // 禁用按钮防止重复点击
                btnContinue.disabled = true;
                btnContinue.textContent = "Bypassing...";

                // 🛡️ 核心修复：先告诉后台“放行这个域名”，等后台真正写完 DNR 规则后再跳转
                chrome.runtime.sendMessage({ type: 'ADD_TEMP_WHITELIST', domain: pureDomain }, (res) => {
                    if (res && res.ok) {
                        // 加了 100ms 延迟，确保 Chrome 浏览器的 DNR 引擎加载了新的放行规则
                        setTimeout(() => {
                            window.location.href = targetDomain.startsWith('http') ? targetDomain : `https://${targetDomain}`;
                        }, 100);
                    } else {
                        alert("放行失败，请重试！");
                        btnContinue.disabled = false;
                        btnContinue.textContent = "I am an expert, ignore risk";
                    }
                });
            } else {
                window.history.back();
            }
        };
    }

    // 处理 intel 拦截的定制 UI
    if (type === 'intel') {
        document.title = "DewSecure PRO - Threat Blocked";
        
        const proTip = document.getElementById('pro-tip');
        if (proTip) proTip.style.display = 'none';

        // 🛡️ 修复：把选择权交给用户，保留“我是专家”按钮，不隐藏
        // if (btnContinue) btnContinue.style.display = 'none';

        if (btnClose) {
            btnClose.textContent = "Close this page";
            btnClose.style.background = "#ef4444";
        }
    } else {
        const { dewsecure_user } = await chrome.storage.local.get('dewsecure_user');
        const isPro = dewsecure_user && ['pro', 'trial', 'family', 'premium'].includes(dewsecure_user.tier);
        const proTip = document.getElementById('pro-tip');
        if (isPro && proTip) {
            proTip.style.display = 'none';
        }
    }
});
