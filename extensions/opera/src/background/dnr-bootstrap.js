// ==========================================
// 🛡️ DNR 规则引导：官方豁免 + 挖矿拦截 + 隐私净化
// ==========================================
import { syncRules, RANGE } from './dnrOwner.js';
import { MINING_DOMAINS } from './aiConfig.js';
import { TARGET_DOMAINS, TRACKING_KEYS } from './security.js';

export function bootstrapDNR() {
    // 🌟 防线 3：全局最高优先级豁免 (防止未来任何新模块误伤官方)
    // 改用 DynamicRules 并设置最高优先级，确保在 DNR 底层绝对放行
    syncRules(RANGE.official, [{
        "id": 999999,
        "priority": 2147483647, // 最高优先级，碾压一切静态/动态拦截规则
        "action": { "type": "allow" }, // 改为 allow，全资源放行
        "condition": {
            "requestDomains": [
                "dewsecure.com", "api.dewsecure.com", "dewsecure-api.zero6039.workers.dev",
                "dropbox.com", "dropboxstatic.com", "dropboxusercontent.com"
            ],
            "resourceTypes": ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
        }
    }]);

    // 🚀 注入挖矿域名 DNR 拦截
    if (MINING_DOMAINS && MINING_DOMAINS.length > 0) {
        const miningRules = MINING_DOMAINS.map((domain, index) => ({
            id: 900000 + index, // 使用 90 万段 ID，避开其他模块
            priority: 2000000,
            action: { type: 'block' },
            condition: {
                requestDomains: [domain],
                resourceTypes: ["sub_frame", "script", "object", "xmlhttprequest", "websocket", "other"]
            }
        }));
        syncRules(RANGE.mining, miningRules);
    }

    // 🚀 注入隐私净化动态规则 (不受静态额度限制，绝不与 11 万条规则冲突)
    const privacyRules = [
        // 1. 剔除追踪参数 (优先级 100，最高，且移除 urlFilter，让引擎自动识别参数)
        {
            "id": 10002, "priority": 100,
            "action": {
                "type": "redirect",
                "redirect": {
                    "transform": {
                        "queryTransform": {
                            "removeParams": ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "yclid", "msclkid", "mc_cid", "mc_eid", "igshid", "mkt_tok", "oly_enc_id", "oly_anon_id"]
                        }
                    }
                }
            },
            "condition": {
                "resourceTypes": ["main_frame", "sub_frame"]
            }
        },
        // 2. 强制 HTTPS 升级 (优先级 10)
        {
            "id": 10001, "priority": 10, "action": { "type": "upgradeScheme" },
            "condition": {
                "resourceTypes": ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"]
            }
        },
        // 🛡️ N-11 修复：放行内网地址与 localhost，防止 HTTPS 强制升级导致无法访问
        {
            "id": 10004, "priority": 11, "action": { "type": "allow" },
            "condition": {
                "resourceTypes": ["main_frame", "sub_frame", "xmlhttprequest", "script", "image", "stylesheet", "font", "media", "websocket", "other"],
                "regexFilter": "^http://(localhost|127\\.[0-9.]+|10\\.[0-9.]+|192\\.168\\.[0-9.]+|172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9.]+|[^/:]+\\.(local|lan|internal|home)|[^/.:]+)(:[0-9]+)?(/|$)"
            }
        },
        // 🛡️ N-15 优化：网络层联盟参数净化 (优先级 12，高于 HTTPS 升级)
        {
            "id": 10005, "priority": 12,
            "action": {
                "type": "redirect",
                "redirect": {
                    "transform": {
                        "queryTransform": {
                            "removeParams": TRACKING_KEYS
                        }
                    }
                }
            },
            "condition": {
                "requestDomains": TARGET_DOMAINS,
                "resourceTypes": ["main_frame", "sub_frame", "xmlhttprequest"]
            }
        },
        // 3. 注入 Sec-GPC 隐私信号 (优先级 1)
        {
            "id": 10003, "priority": 1,
            "action": { "type": "modifyHeaders", "requestHeaders": [{ "header": "Sec-GPC", "operation": "set", "value": "1" }] },
            "condition": {
                "resourceTypes": ["main_frame", "sub_frame", "xmlhttprequest"]
            }
        }
    ];

    syncRules(RANGE.privacy, privacyRules);
}
