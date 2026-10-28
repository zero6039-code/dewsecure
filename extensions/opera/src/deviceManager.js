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
    else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera';
    else if (ua.includes('Brave')) browser = 'Brave';
    else if (ua.includes('Vivaldi')) browser = 'Vivaldi';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Chrome/')) browser = 'Chrome';

    return { os, browser, deviceName: `${os} - ${browser}` };
}

export async function reportDeviceSilently(token, force = false) {
    if (!token) return { status: 'AUTH_ERROR' };
    
    if (!force) {
        const { [LAST_REPORT_KEY]: lastReport } = await chrome.storage.local.get(LAST_REPORT_KEY);
        if (lastReport && Date.now() - lastReport < 24 * 60 * 60 * 1000) return { status: 'SUCCESS' };
    }

    try {
        const installationId = await getInstallationId();
        const { browser, deviceName } = parseDeviceInfo();

        const payloadBase64 = token.split('.')[1];
        const payload = JSON.parse(atob(payloadBase64));
        const userId = payload.sub;

        const res = await fetch(`${SUPABASE_URL}/rest/v1/devices?on_conflict=user_id,fingerprint`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                user_id: userId,
                fingerprint: installationId,
                device_name: deviceName,
                browser: browser,
                last_seen_at: new Date().toISOString()
            })
        });

        if (res.ok) {
            await chrome.storage.local.set({ [LAST_REPORT_KEY]: Date.now() });
            console.log('✅ [DeviceManager] 设备静默上报成功');
            return { status: 'SUCCESS' };
        } else {
            const errorText = await res.text();
            if (errorText.includes('DEVICE_LIMIT_EXCEEDED')) {
                return { status: 'LIMIT_EXCEEDED' };
            } else if (res.status === 401) {
                return { status: 'AUTH_ERROR' };
            } else {
                console.error('❌ [DeviceManager] 设备上报失败:', res.status, errorText);
                return { status: 'ERROR' };
            }
        }
    } catch (e) {
        console.error('❌ [DeviceManager] 上报异常:', e.message);
        return { status: 'ERROR' };
    }
}
