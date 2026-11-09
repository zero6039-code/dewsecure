// 🔒 S-06 修复：限制 content script 读取 storage.local，保护 Token 安全
if (chrome.storage && chrome.storage.local && chrome.storage.local.setAccessLevel) {
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(e => {
        console.warn('⚠️ 设置 storage 访问级别失败:', e);
    });
}

// 🌟 动态适配 Chrome 与 Edge 的 Side Panel
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.warn);
}

// ==========================================
// 📦 模块导入
// ==========================================
// 原地使用的核心模块（未搬走）
import { initSettings, getSettings, SETTINGS_KEY } from './background/settings.js';
import { updateDNRRulesets } from './background/messageHandler.js';
import { initSecurityListeners } from './background/security.js';
import { initStatsListener } from './background/stats.js';
import { restoreSessionRules } from './background/dnr.js';
import { initThreatFilter } from './background/threatIntel.js';
import { initIntelReporter } from './background/intelReporter.js';

// 拆分出的初始化模块
import { initMessaging } from './background/messaging.js';
import { initNavigation } from './background/navigation.js';
import { checkAndUpdatePhishModel } from './background/phishModelManager.js';
import { initDownloads } from './background/downloads.js';
import { initDevice } from './background/device.js';
import { initSchedules } from './background/schedules.js';
import { bootstrapDNR } from './background/dnr-bootstrap.js';
import { loadBgI18n } from './background/i18n.js';

// ==========================================
// 🚀 顶层初始化
// ==========================================
initSettings().then(async () => {
    const s = await getSettings();

    // 🛡️ Firefox 关键修复：
    // 每次重新载入扩展时，Firefox 会重新应用 manifest.enabled 状态，
    // 导致 ads_1a + ads_1b (共 30000 条) 占满 Firefox 保证配额 (30000)，
    // allowlist 等后续规则集全部无法启用。
    // 这里启动时先 disable 所有大规则集释放配额，再按优先级逐个重建。
    // allowlist 不 disable，确保白名单始终生效。
    try {
        try {
            // 🛡️ 动态获取当前已启用的规则集并全部关闭，彻底释放配额（兼容切分后的 __p1 命名）
            const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
            if (enabled.length > 0) {
                await chrome.declarativeNetRequest.updateEnabledRulesets({
                    disableRulesetIds: enabled
                });
            }
        } catch (e) {
            // 忽略无法关闭的未知错误
        }
    } catch (e) {
        // 部分 ID 在 Firefox 早期版本或切分后不存在，忽略即可
        console.warn('[DNR] 启动清理警告（可忽略）:', e && e.message);
    }

    await updateDNRRulesets(s.dnrEnabled, s.blockTrackers);
});
chrome.action.setBadgeText({ text: '' });
initSecurityListeners();
initStatsListener();
restoreSessionRules();
initThreatFilter(); // 🚀 启动时从 IndexedDB 恢复过滤器
initIntelReporter(); // 🚀 启动静默情报上报服务

// 拆分模块初始化
initMessaging();   // 内部消息 + 外部消息路由
initNavigation();  // tabs.onUpdated AI 检测 + webNavigation 钓鱼拦截
initDownloads();   // 下载守卫
initDevice();      // 设备上报 + Firefox 侧边栏
initSchedules();   // 威胁情报 + 模型更新定时任务
bootstrapDNR();
checkAndUpdatePhishModel();    // DNR 规则（官方豁免 + 挖矿 + 隐私）
loadBgI18n();      // 后台多语言引擎
