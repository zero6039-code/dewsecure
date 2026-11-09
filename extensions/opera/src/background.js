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
import { purgeExpiredTempAllow } from './background/tempWhitelistManager.js';
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
import { ensureAlarm } from './background/alarmHelper.js';

// ==========================================
// 🚀 顶层初始化
// ==========================================
initSettings().then(async () => {
    const s = await getSettings();

    // 🛡️ P-4 优化：Firefox 下配额紧张，需强制重排；而 Chrome 下配额充足，直接按需更新，避免无谓的规则重编译。
    const isFirefox = navigator.userAgent.includes('Firefox');
    
    if (isFirefox) {
        try {
            const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
            if (enabled.length > 0) {
                await chrome.declarativeNetRequest.updateEnabledRulesets({
                    disableRulesetIds: enabled
                });
            }
        } catch (e) {
            console.warn('[DNR] Firefox 启动清理警告（可忽略）:', e && e.message);
        }
    }

    // updateDNRRulesets 内部已包含 getEnabledRulesets 的比较逻辑，相同则自动跳过
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
checkAndUpdatePhishModel({ force: false }).catch(() => {});
loadBgI18n();      // 后台多语言引擎

// 🛡️ A-2 修复：每 10 分钟清理一次过期的临时白名单 Session 规则
ensureAlarm('dew_purge_temp', { periodInMinutes: 10 }).catch(() => {});
ensureAlarm('dew_check_phish_model', { periodInMinutes: 360 }).catch(() => {}); // 6 小时检查一次模型
chrome.alarms.onAlarm.addListener(a => {
    if (a.name === 'dew_purge_temp') {
        purgeExpiredTempAllow();
    }
    if (a.name === 'dew_check_phish_model') {
        checkAndUpdatePhishModel({ force: true });
    }
});
// 启动时立即清理一次
purgeExpiredTempAllow();
