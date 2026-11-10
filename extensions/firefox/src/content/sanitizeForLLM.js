// ============================================================================
// 🛡️ SAN-6: LLM 提示词注入防护 - 文本净化器
// 剔除隐藏元素、Unicode Tag 字符、零宽字符、双向控制符
// ============================================================================

const INVISIBLE_CHARS = /[\u200B-\u200D\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

function isHidden(el) {
    if (!el) return false;
    const tag = el.tagName;
    // 快速跳过：不可见标签、脚本、样式
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'META') return true;

    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
    
    // 字号极小（常用于隐藏文本）
    if (parseFloat(cs.fontSize) < 2) return true;

    // 只有当元素有实际尺寸时，才触发 Layout 获取坐标（减少性能开销）
    if (el.getBoundingClientRect) {
        const r = el.getBoundingClientRect();
        // 移出屏幕外
        if (r.right < -100 || r.bottom < -100) return true;
    }
    return false;
}

export function sanitizeForLLM(root = document.body, maxChars = 12000) {
    let result = '';
    let charCount = 0;
    
    // 支持穿透 Shadow DOM 的遍历器
    function walk(node) {
        if (charCount >= maxChars) return;
        
        // 如果是元素节点，检查是否隐藏
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (isHidden(node)) return;
            
            // 处理 Shadow DOM
            if (node.shadowRoot) {
                for (const child of node.shadowRoot.childNodes) {
                    walk(child);
                }
            }
        }
        
        // 如果是文本节点，清洗并累加
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.nodeValue.replace(INVISIBLE_CHARS, '').trim();
            if (text) {
                if (result.length > 0) result += ' ';
                result += text;
                charCount += text.length;
            }
        }
        
        // 递归子节点
        for (const child of node.childNodes) {
            walk(child);
        }
    }

    walk(root);
    return result.slice(0, maxChars);
}
