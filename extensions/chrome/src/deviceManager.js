// ==========================================
// 📁 deviceManager.js
// 职责：生成混合指纹，静默上报设备到 Supabase
// ==========================================
const SUPABASE_URL = 'https://uvbaioqqjqseapcancvi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xiiA-yt_jRKkzRdkYkoWJA_CVZjNjq8';
const INSTALLATION_KEY = 'dewsecure_installation_id';
const LAST_REPORT_KEY = 'dewsecure_last_device_report';

export async function getInstallationId() {
    let { [INSTALLATION_KEY]: id } = await chrome.storage.local.get(INSTALLATION_KEY);
    if (!id) {
        id = crypto.randomUUID();
        await chrome.storage.local.set({ [INSTALLATION_KEY]: id });
    }
    return id;
}

function parseDeviceInfo() {
    const ua = navigator.userAgent;
    let os = 'Unknown OS';
    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    let browser = 'Unknown Browser';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Chrome/')) browser = 'Chrome';

    return { os, browser, deviceName: `${os} - ${browser}` };
}

export async function reportDeviceSilently(token) {
    if (!token) return;
    
    // 24小时节流
    const { [LAST_REPORT_KEY]: lastReport } = await chrome.storage.local.get(LAST_REPORT_KEY);
    if (lastReport && Date.now() - lastReport < 24 * 60 * 60 * 1000) return;

    try {
        const installationId = await getInstallationId();
        const { browser, deviceName } = parseDeviceInfo();

        // 获取 Supabase Auth 里的 user_id (从 JWT 中解析)
        const payloadBase64 = token.split('.')[1];
        const payload = JSON.parse(atob(payloadBase64));
        const userId = payload.sub;

        const res = await fetch(`${SUPABASE_URL}/rest/v1/devices`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates' // 基于 fingerprint 去重更新
            },
            body: JSON.stringify({
                user_id: userId,
                fingerprint: installationId, // 混合兜底：用 UUID 做指纹，防浏览器升级掉槽位
                device_name: deviceName,
                browser: browser,
                last_seen_at: new Date().toISOString()
            })
        });

        if (res.ok) {
            await chrome.storage.local.set({ [LAST_REPORT_KEY]: Date.now() });
            console.log('✅ [DeviceManager] 设备静默上报成功');
        } else {
            console.warn('⚠️ [DeviceManager] 设备上报失败:', await res.text());
        }
    } catch (e) {
        console.error('❌ [DeviceManager] 上报异常:', e);
    }
}
