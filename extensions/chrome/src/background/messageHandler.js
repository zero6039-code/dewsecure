import { isExtensionSender, isPrivilegedSender } from './handlers/validators.js';
export { updateDNRRulesets } from './handlers/ruleset.js';
import { handleDomAdHidden, handleGetLogs, handleGetStats, handleReportFeedback } from './handlers/telemetry.js';
import { handleGetSettings, handleUpdateSettingKey, handleUpdateSettings } from './handlers/settings.js';
import { handleAddWhitelist, handleRemoveWhitelist, handleAddTempWhitelist, handleRemoveTempWhitelist } from './handlers/whitelist.js';

export async function handleMessage(message, sender) {
    if (!isExtensionSender(sender)) return { error: 'Unauthorized sender' };
    const privilegedTypes = ['UPDATE_SETTING_KEY', 'UPDATE_SETTINGS', 'ADD_WHITELIST', 'REMOVE_WHITELIST', 'ADD_TEMP_WHITELIST', 'REMOVE_TEMP_WHITELIST', 'REPORT_FEEDBACK', 'GET_LOGS', 'GET_STATS'];
    if (privilegedTypes.includes(message.type) && !isPrivilegedSender(sender)) return { error: 'Privileged sender required' };

    switch (message.type) {
        case 'DOM_AD_HIDDEN': return await handleDomAdHidden(message);
        case 'GET_LOGS': return await handleGetLogs();
        case 'GET_STATS': return await handleGetStats();
        case 'REPORT_FEEDBACK': return await handleReportFeedback(message);
        case 'GET_SETTINGS': return await handleGetSettings();
        case 'UPDATE_SETTING_KEY': return await handleUpdateSettingKey(message);
        case 'UPDATE_SETTINGS': return await handleUpdateSettings(message);
        case 'ADD_WHITELIST': return await handleAddWhitelist(message);
        case 'REMOVE_WHITELIST': return await handleRemoveWhitelist(message);
        case 'ADD_TEMP_WHITELIST': return await handleAddTempWhitelist(message);
        case 'REMOVE_TEMP_WHITELIST': return await handleRemoveTempWhitelist(message);
        default: return { error: '未知消息类型' };
    }
}
