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
    // 兼容兼容 domain 和 url，同时过滤掉错误的 \0
    let targetDomain = params.get('domain') || params.get('url');
    if (targetDomain === '\\0' || targetDomain === '%5C0') {
        targetDomain = 'Known Malicious Site';
    }

    // 1. 真实显示被拦截的域名
    const dangerUrl = document.getElementById('danger-url');
    if (dangerUrl) {
        dangerUrl.textContent = targetDomain ? decodeURIComponent(targetDomain) : 'Unknown Malicious Site';
    }

    // 2. 绑定真实按钮功能
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
                // 强制把用户送回原网址
                window.location.href = targetDomain.startsWith('http') ? targetDomain : `http://${targetDomain}`;
            } else {
                window.history.back();
            }
        };
    }

    // 3. 处理 intel 拦截的定制 UI（隐藏放行与 PRO 提示）
    if (type === 'intel') {
        document.title = "DewSecure PRO - Threat Blocked";
        
        // 隐藏底部的 PRO 提示框
        const proTip = document.getElementById('pro-tip');
        if (proTip) proTip.style.display = 'none';

        // 隐藏"我是专家"按钮，绝不给放行
        if (btnContinue) btnContinue.style.display = 'none';

        // 关闭按钮改红
        if (btnClose) {
            btnClose.textContent = "Close this page";
            btnClose.style.background = "#ef4444";
        }
    } else {
        // 普通的钓鱼页面逻辑
        // 检查是否是 Pro，决定是否显示底部的提示
        const { dewsecure_user } = await chrome.storage.local.get('dewsecure_user');
        const isPro = dewsecure_user && ['pro', 'trial', 'family', 'premium'].includes(dewsecure_user.tier);
        const proTip = document.getElementById('pro-tip');
        if (isPro && proTip) {
            proTip.style.display = 'none';
        }
    }
});
