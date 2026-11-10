import { state } from './state.js';

export function triggerPhishingWarning(score, reasons) {
    if (document.getElementById('dewsecure-phishing-warning-host')) return;

    const tTitle = state.contentDict['phish_title'] || '🚨 Security Warning: DewSecure Phishing Detected';
    const tDesc = state.contentDict['phish_desc'] || 'This page is trying to steal your password.';
    const tBtn = state.contentDict['phish_continue'] || 'I am sure it\'s safe, continue';

    const host = document.createElement('div');
    host.id = 'dewsecure-phishing-warning-host';
    host.style.cssText = 'display: block !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; z-index: 2147483647 !important;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const banner = document.createElement('div');
    banner.style.cssText = `background: #ef4444; color: white; padding: 12px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 14px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1);`;

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = 'flex: 1; display: flex; align-items: center; justify-content: center; padding-right: 20px;';

    // 🛡️ 加入 DewSecure 品牌水滴图标
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.style.cssText = 'flex-shrink: 0; margin-right: 12px;';
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z');
    svg.appendChild(path);
    contentDiv.appendChild(svg);

    const textDiv = document.createElement('div');
    textDiv.style.cssText = 'text-align: left;';

    const titleStrong = document.createElement('strong');
    titleStrong.textContent = tTitle;
    textDiv.appendChild(titleStrong);
    textDiv.appendChild(document.createTextNode(' ' + tDesc));

    const reasonDiv = document.createElement('div');
    reasonDiv.style.cssText = 'font-size: 12px; opacity: 0.8; margin-top: 4px;';

    // 🛡️ 提供缺省翻译兜底
    const reasonText = reasons.map(r => {
        let text = state.contentDict[r.key];
        if (!text && r.key === 'reason_bitb') text = 'Fake Browser Address Bar ({arg})';
        text = text || r.key;
        return text.replace('{arg}', r.arg || '');
    }).join(', ');
    
    reasonDiv.textContent = reasonText;
    textDiv.appendChild(reasonDiv);

    contentDiv.appendChild(textDiv);



    const btn = document.createElement('button');
    btn.id = 'dewsecure-phishing-ignore';
    btn.style.cssText = 'background: transparent; border: 1px solid white; color: white; padding: 4px 12px; border-radius: 4px; cursor: pointer;';
    btn.textContent = tBtn;

    banner.appendChild(contentDiv);
    banner.appendChild(btn);
    shadow.appendChild(banner);
    document.documentElement.appendChild(host);

    shadow.getElementById('dewsecure-phishing-ignore').addEventListener('click', () => {
        state.phishingIgnored = true;
        host.remove();
        console.warn('🛡️ [DewSecure] 用户选择了忽略警告，已恢复表单输入。');
    });
}
