
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

    // 🚀 下载拦截专属逻辑
    if (type === 'download') {
        const filename = params.get('filename') || '未知文件';
        
        const DOWNLOAD_I18N = {
            'zh': { title: '⚠️ 已拦截高危下载', desc: 'DewSecure 拦截了文件 <strong>{filename}</strong> 的下载。<br><br>检测到双重扩展名（例如 .pdf.exe），这是黑客用于伪装恶意软件（病毒、木马）的典型手段，系统已强制阻断。', btn: '关闭此页面' },
            'en': { title: '⚠️ High-Risk Download Blocked', desc: 'DewSecure blocked the download of <strong>{filename}</strong>.<br><br>A double extension (e.g., .pdf.exe) was detected, which is a typical method used by hackers to disguise malware (viruses, trojans).', btn: 'Close this page' },
            'de': { title: '⚠️ Riskanter Download blockiert', desc: 'DewSecure hat den Download von <strong>{filename}</strong> blockiert.<br><br>Es wurde eine doppelte Dateiendung (z. B. .pdf.exe) erkannt. Dies ist eine typische Methode von Hackern, um Malware zu tarnen.', btn: 'Diese Seite schließen' },
            'es': { title: '⚠️ Descarga de alto riesgo bloqueada', desc: 'DewSecure bloqueó la descarga de <strong>{filename}</strong>.<br><br>Se detectó una doble extensión (ej. .pdf.exe), un método típico de hackers para disfrazar malware.', btn: 'Cerrar esta página' },
            'fr': { title: '⚠️ Téléchargement à haut risque bloqué', desc: 'DewSecure a bloqué le téléchargement de <strong>{filename}</strong>.<br><br>Une double extension (ex. .pdf.exe) a été détectée, une méthode typique pour déguiser des malwares.', btn: 'Fermer cette page' },
            'ja': { title: '⚠️ 危険なダウンロードをブロック', desc: 'DewSecureは<strong>{filename}</strong>のダウンロードをブロックしました。<br><br>二重拡張子（例：.pdf.exe）が検出されました。これはハッカーがマルウェアを偽装する一般的な手法です。', btn: 'このページを閉じる' },
            'ko': { title: '⚠️ 고위험 다운로드 차단됨', desc: 'DewSecure가 <strong>{filename}</strong> 다운로드를 차단했습니다.<br><br>이중 확장자(예: .pdf.exe)가 감지되었습니다. 해커가 악성코드를 위장하는 일반적인 방법입니다.', btn: '이 페이지 닫기' },
            'ms': { title: '⚠️ Muat Turun Berisiko Tinggi Disekat', desc: 'DewSecure menyekat muat turun <strong>{filename}</strong>.<br><br>Sambungan berganda (cth. .pdf.exe) dikesan, kaedah biasa penggodam menyamar perisian hasad.', btn: 'Tutup halaman ini' },
            'pt': { title: '⚠️ Download de Alto Risco Bloqueado', desc: 'O DewSecure bloqueou o download de <strong>{filename}</strong>.<br><br>Uma extensão dupla (ex. .pdf.exe) foi detectada, um método típico de hackers para disfarçar malware.', btn: 'Fechar esta página' }
        };

        const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
        const t = DOWNLOAD_I18N[lang] || DOWNLOAD_I18N['en'];

        const titleEl = document.querySelector('h1');
        if (titleEl) {
            titleEl.textContent = t.title;
            titleEl.style.color = '#ef4444';
            titleEl.removeAttribute('data-i18n');
        }
        
        const descEl = document.querySelector('p');
        if (descEl) {
            // 🛡️ N-4 修复：改用 textContent，彻底杜绝 XSS 注入
            descEl.style.whiteSpace = 'pre-line';
            descEl.textContent = t.desc
                .replaceAll('<br>', '\n')
                .replaceAll('<strong>', '')
                .replaceAll('</strong>', '')
                .replace('{filename}', filename);
            descEl.removeAttribute('data-i18n');
        }
        
        const dangerUrlEl = document.getElementById('danger-url');
        if (dangerUrlEl) {
            dangerUrlEl.textContent = filename;
            dangerUrlEl.style.color = '#ef4444';
            dangerUrlEl.style.fontWeight = 'bold';
            dangerUrlEl.style.backgroundColor = '#2a1515';
            dangerUrlEl.style.border = '1px solid #ef4444';
        }
        
        const btnContinue = document.getElementById('btn-continue');
        if (btnContinue) {
            btnContinue.textContent = '我已知晓风险，强制下载';
            btnContinue.removeAttribute('data-i18n');
            btnContinue.onclick = () => {
                const fileUrl = params.get('url');
                if (fileUrl) {
                    // 🛡️ 防抖：点击后立刻禁用按钮，防止用户狂点导致后台逻辑并发
                    btnContinue.disabled = true;
                    btnContinue.textContent = '正在启动下载...';
                    
                    // 通知后台强制下载
                    chrome.runtime.sendMessage({ type: 'FORCE_DOWNLOAD', url: fileUrl, filename }, () => {
                        setTimeout(() => window.close(), 100); // 给消息传递留出一点时间
                    });
                }
            };
        }
        
        const btnClose = document.getElementById('btn-close');
        if (btnClose) {
            btnClose.textContent = t.btn;
            btnClose.removeAttribute('data-i18n');
            btnClose.style.background = '#ef4444';
            btnClose.onclick = () => window.close();
        }
        
        return;
    }
    
    // 🔒 M-1 修复：杜绝二次 decodeURIComponent 抛错
    const raw = params.get('domain') || params.get('url') || '';
    let targetUrlObj = null;
    let displayDomain = raw; // 默认直接显示原文本

    if (raw === '\\0' || raw === '%5C0' || !raw) {
        displayDomain = 'Known Malicious Site';
    } else {
        try { 
            // 尝试构造 URL 对象，用于后续的“继续访问”跳转
            targetUrlObj = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); 
            // 如果构造成功，显示 hostname（更干净）
            displayDomain = targetUrlObj.hostname;
        } catch (e) {
            // 如果解析失败（比如传了空格等非法字符），直接保留原始字符串展示
            displayDomain = raw;
        }
    }
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
            if (targetUrlObj && displayDomain !== 'Known Malicious Site') {
                // 🛡️ 协议白名单，防止 javascript: 等 XSS 注入
                if (!/^https?:$/i.test(targetUrlObj.protocol)) {
                    alert('Invalid URL protocol.');
                    return;
                }
                
                const pureDomain = targetUrlObj.hostname;
                
                // 禁用按钮防止重复点击
                btnContinue.disabled = true;
                btnContinue.textContent = "Bypassing...";

                // 🛡️ 核心修复：先告诉后台“放行这个域名”，等后台真正写完 DNR 规则后再跳转
                chrome.runtime.sendMessage({ type: 'ADD_TEMP_WHITELIST', domain: pureDomain }, (res) => {
                    if (res && res.ok) {
                        // 加了 100ms 延迟，确保 Chrome 浏览器的 DNR 引擎加载了新的放行规则
                        setTimeout(() => {
                            window.location.href = targetUrlObj.href;
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

    // 处理 affiliate 推广链接拦截的 UI
    if (type === 'affiliate') {
        document.title = "DewSecure - Affiliate Link Blocked";
        const h1 = document.querySelector('h1');
        if (h1) h1.textContent = "Malicious Promo Link Blocked";
        const p = document.querySelector('p');
        if (p) p.textContent = "DewSecure blocked this URL because it contains aggressive tracking or affiliate parameters.";
    }
    // 处理 intel 拦截的定制 UI
    else if (type === 'intel') {
        document.title = "DewSecure PRO - Threat Blocked";
        
        const proTip = document.getElementById('pro-tip');
        if (proTip) proTip.style.display = 'none';

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

        // 🛡️ 展示拦截理由（如果传入了 reasons 参数）
        const reasonsParam = params.get('reasons');
        if (reasonsParam) {
            const dangerUrlEl = document.getElementById('danger-url');
            if (dangerUrlEl) {
                // 获取本地化文本
                const langRes = await chrome.storage.local.get('preferred_lang');
                let targetLang = langRes.preferred_lang || (navigator.language || 'en').split('-')[0].toLowerCase();
                if (targetLang === 'zh_CN') targetLang = 'zh';
                
                let dict = {};
                try {
                    const dictRes = await fetch(chrome.runtime.getURL(`popup/locales/${targetLang}.json`));
                    if (dictRes.ok) dict = await dictRes.json();
                } catch (e) {}

                const reasonTitle = dict['warn_reasons_title'] || 'Detection Reasons:';
                const reasonLines = decodeURIComponent(reasonsParam).split(', ').map(r => {
                    const parts = r.split(':');
                    const code = parts[0].replace(/[-+]/g, '_'); // 统一将 '-' 和 '+' 转为 '_'
                    const arg = parts[1] || '';
                    let text = dict['warn_reason_' + code] || r;
                    return '• ' + text.replace('{arg}', arg);
                });

                const reasonBox = document.createElement('div');
                reasonBox.style.cssText = 'margin-top: 10px; margin-bottom: 20px; padding: 12px; background: #2a1515; border: 1px solid #ef4444; border-radius: 8px; color: #fca5a5; font-size: 13px; text-align: left; width: 100%; box-sizing: border-box;';
                reasonBox.innerHTML = `<strong>${reasonTitle}</strong><br>${reasonLines.join('<br>')}`;
                dangerUrlEl.parentNode.appendChild(reasonBox);
            }
        }
    }
});
