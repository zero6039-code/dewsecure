// ==========================================
// 🌐 终极逐帧双语引擎 (根除闪烁与死循环)
// ==========================================
const dictEn = {
    "设置": "Settings", "语言": "Language", "白名单": "Whitelist", 
    "帮助改进 DewSecure": "Help improve DewSecure", 
    "您的反馈将匿名上传，帮助 AI 持续进化": "Feedback is anonymous and helps AI evolve",
    "保护功能": "Protection Features", "DNR 规则拦截": "DNR Rule Blocking", 
    "包含已知恶意域名、广告与追踪器（基础免费）": "Blocks known malicious domains, ads & trackers",
    "防点击劫持 (防弹窗)": "Anti-Clickjacking", "阻断恶意网站透明遮罩与点击重定向": "Prevents malicious transparent overlays",
    "钓鱼网站 AI 检测": "AI Phishing Detection", "智能识别恶意与钓鱼网页": "Identifies malicious and phishing pages",
    "AI 实时检测（四分类）": "AI Smart Real-time Detection", "AI 智能实时检测": "AI Smart Real-time Detection",
    "识别规则库未收录的广告与威胁": "Identifies uncaptured ads and threats", "AI 智能拦截": "AI Smart Blocking",
    "阻止追踪器": "Block Trackers", "拦截跟踪脚本和像素": "Intercepts tracking scripts and pixels",
    "反反拦截保护": "Anti-Adblock Protection", "防止网站检测拦截器": "Prevents sites from detecting the blocker",
    "隐藏 Cookie 弹窗": "Hide Cookie Banners", "隐藏 Cookie 同意横幅": "Hides cookie consent banners",
    "隐藏广告占位符": "Hide Ad Placeholders", "移除广告留下的空白": "Removes blank spaces left by ads",
    "拦截社交追踪": "Block Social Trackers", "阻止社交媒体追踪按钮": "Blocks social media tracking buttons",
    "今日拦截": "Blocked Today", "累计拦截": "Total Blocked", "暂无白名单": "No whitelist yet", 
    "暂无拦截记录": "No block records yet", "白名单列表": "Whitelist", "添加": "Add", "总计拦截": "Total Blocked",
    "已登录": "Logged In", "订阅状态": "Subscription", "高级版": "PRO", "到期时间": "Expiry Date", 
    "设备": "Devices", "管理账号": "Manage Account", "退出登录": "Log Out", "输入验证码": "Enter OTP", 
    "发送验证码": "Send OTP", "验证": "Verify", "重新发送验证码": "Resend OTP", "← 返回修改邮箱": "← Back to email", 
    "登录 / 注册": "Login / Register", "首次使用将自动创建账号": "Account auto-created on first use",
    "使用 Google 账号登录": "Sign in with Google", "或": "OR", "免费版": "Free", "点击激活 30 天高级版": "Activate 30-Day Pro",
    "漏拦广告": "Missed Ad", "误拦内容": "False Block"
};

const dictZh = {
    "Settings": "设置", "Language": "语言", "Whitelist": "白名单", 
    "Help improve DewSecure": "帮助改进 DewSecure",
    "Feedback is anonymous and helps AI evolve": "您的反馈将匿名上传，帮助 AI 持续进化",
    "Protection Features": "保护功能", "DNR Rule Blocking": "DNR 规则拦截",
    "Blocks known malicious domains, ads & trackers": "包含已知恶意域名、广告与追踪器（基础免费）",
    "Anti-Clickjacking": "防点击劫持 (防弹窗)", "Prevents malicious transparent overlays": "阻断恶意网站透明遮罩与点击重定向",
    "AI Phishing Detection": "钓鱼网站 AI 检测", "Identifies malicious and phishing pages": "智能识别恶意与钓鱼网页",
    "AI Smart Real-time Detection": "AI 实时检测（四分类）", "Identifies uncaptured ads and threats": "识别规则库未收录的广告与威胁",
    "AI Smart Blocking": "AI 智能拦截", "Block Trackers": "阻止追踪器", "Intercepts tracking scripts and pixels": "拦截跟踪脚本和像素",
    "Anti-Adblock Protection": "反反拦截保护", "Prevents sites from detecting the blocker": "防止网站检测拦截器",
    "Hide Cookie Banners": "隐藏 Cookie 弹窗", "Hides cookie consent banners": "隐藏 Cookie 同意横幅",
    "Hide Ad Placeholders": "隐藏广告占位符", "Removes blank spaces left by ads": "移除广告留下的空白",
    "Block Social Trackers": "拦截社交追踪", "Blocks social media tracking buttons": "阻止社交媒体追踪按钮",
    "Blocked Today": "今日拦截", "Total Blocked": "累计拦截", "No whitelist yet": "暂无白名单", 
    "No block records yet": "暂无拦截记录", "Add": "添加",
    "Logged In": "已登录", "Subscription": "订阅状态", "PRO": "高级版", "Expiry Date": "到期时间", 
    "Devices": "设备", "Manage Account": "管理账号", "Log Out": "退出登录", "Enter OTP": "输入验证码", 
    "Send OTP": "发送验证码", "Verify": "验证", "Resend OTP": "重新发送验证码", "← Back to email": "← 返回修改邮箱", 
    "Login / Register": "登录 / 注册", "Account auto-created on first use": "首次使用将自动创建账号",
    "Sign in with Google": "使用 Google 账号登录", "OR": "或", "Free": "免费版", "Activate 30-Day Pro": "点击激活 30 天高级版",
    "Missed Ad": "漏拦广告", "False Block": "误拦内容"
};

let currentLang = 'en';

// 1. 静态翻译 (只在启动和切换语言时执行一次，节省性能)
function applyStaticTranslations() {
    if (!document.body) return;
    const dict = currentLang === 'en' ? dictEn : dictZh;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        const text = node.textContent.trim();
        if (dict[text]) {
            node.textContent = node.textContent.replace(text, dict[text]);
        }
    }
}

// 2. 动态翻译 (极致严格，绝不乱动已经正确的文字)
function syncDynamicText() {
    if (!document.body) return;
    const isEn = currentLang === 'en';

    const safeSet = (el, target, condition) => {
        if (!el) return;
        if (el.textContent.trim() === target) return; // 如果已经是目标文字，立刻跳过，防止重绘闪烁
        if (condition(el.textContent)) el.textContent = target;
    };

    const status = document.getElementById('status');
    if (status) {
        if (isEn) safeSet(status, 'Protected', t => t.includes('保护中'));
        else safeSet(status, '保护中', t => t.includes('Protected'));
    }

    // 这里是跳动重灾区，加强保护
    const siteLabel = document.getElementById('siteLabel');
    if (siteLabel) {
        if (isEn) safeSet(siteLabel, 'Protection On', t => t.includes('保护已开启'));
        else safeSet(siteLabel, '保护已开启', t => t.includes('Protection On'));
    }

    const loginBtn = document.getElementById('loginBtnText');
    if (loginBtn) {
        if (isEn) {
            safeSet(loginBtn, 'View Status', t => t.includes('查看状态'));
            safeSet(loginBtn, 'Log In', t => t.includes('登录'));
        } else {
            safeSet(loginBtn, '查看状态', t => t.includes('View Status'));
            safeSet(loginBtn, '登录', t => t.includes('Log In'));
        }
    }

    const upgBtn = document.querySelector('.btn-upgrade-text');
    if (upgBtn) {
        if (isEn) {
            safeSet(upgBtn, 'Upgraded', t => t.includes('已升级到高级版'));
            safeSet(upgBtn, 'Upgrade to Pro', t => t.includes('升级到高级版'));
        } else {
            safeSet(upgBtn, '已升级到高级版', t => t.includes('Upgraded'));
            safeSet(upgBtn, '升级到高级版', t => t.includes('Upgrade to Pro'));
        }
    }

    const tier = document.getElementById('accountTier');
    if (tier) {
        if (isEn) safeSet(tier, 'PRO', t => t.includes('高级版'));
        else safeSet(tier, '高级版', t => t.includes('PRO'));
    }

    // 针对包含 Emoji 的元素
    const feedbackTitle = document.querySelector('.feedback-title');
    if (feedbackTitle) {
        if (isEn && feedbackTitle.textContent.includes('帮助改进')) {
            feedbackTitle.innerHTML = '🛠️ Help improve DewSecure';
        } else if (!isEn && feedbackTitle.textContent.includes('Help improve')) {
            feedbackTitle.innerHTML = '🛠️ 帮助改进 DewSecure';
        }
    }
    const reportMissed = document.getElementById('reportMissed');
    if (reportMissed) {
        if (isEn && reportMissed.textContent.includes('漏拦')) reportMissed.innerHTML = '😤 Missed Ad';
        else if (!isEn && reportMissed.textContent.includes('Missed')) reportMissed.innerHTML = '😤 漏拦广告';
    }
    const reportFalse = document.getElementById('reportFalse');
    if (reportFalse) {
        if (isEn && reportFalse.textContent.includes('误拦')) reportFalse.innerHTML = '😡 False Block';
        else if (!isEn && reportFalse.textContent.includes('False')) reportFalse.innerHTML = '😡 误拦内容';
    }
}

// 3. 语言切换
function switchLang(lang) {
    if (currentLang === lang) return;
    currentLang = lang;
    chrome.storage.local.set({ preferred_lang: lang });
    
    document.querySelectorAll('.lang-option').forEach(el => {
        if (el.getAttribute('data-lang') === lang) el.classList.add('active');
        else el.classList.remove('active');
    });
    
    applyStaticTranslations();
    syncDynamicText();
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-option');
    if (btn) switchLang(btn.getAttribute('data-lang'));
}, true);

// 4. 核心绝杀：使用 requestAnimationFrame (逐帧同步渲染)
function renderLoop() {
    syncDynamicText();
    requestAnimationFrame(renderLoop); // 在下一帧渲染前再次执行
}

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get('preferred_lang', (res) => {
        currentLang = res.preferred_lang || 'en';
        applyStaticTranslations();
        
        // 启动逐帧同步引擎，彻底消灭闪烁！
        requestAnimationFrame(renderLoop);
    });
});
