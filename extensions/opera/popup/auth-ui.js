// ==========================================
// 📁 auth-ui.js
// 职责：专门处理认证弹窗（登录/注册）的所有逻辑。
// ==========================================

import { sendOTP, verifyOTP, getCurrentUser } from '../src/authManager.js';
import { renderLoggedInView } from './account-ui.js';

// 切换认证步骤（email -> otp -> logged-in）
export function showAuthStep(step) {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    
    modal.querySelectorAll('.auth-step').forEach((el) => {
        el.classList.toggle('hidden', el.dataset.step !== step);
    });

    if (step === 'otp') {
        const otpInput = document.getElementById('otpInput');
        if (otpInput) {
            setTimeout(() => otpInput.focus(), 100);
            otpInput.value = '';
            otpInput.classList.remove('error');
        }
    }

    // 🚀 核心修复：当切回邮箱界面时，强制重置发送按钮，防止卡在 "..." 无法点击
    if (step === 'email') {
        const btnSend = document.getElementById('sendOtpBtn');
        if (btnSend) {
            btnSend.disabled = false;
            btnSend.textContent = window.t ? window.t('auth_send_otp') : '发送验证码';
        }
    }
}

// 初始化认证交互
export function initAuthUI() {
    const emailInput = document.getElementById('authEmail');
    const otpInput = document.getElementById('otpInput');
    const btnSend = document.getElementById('sendOtpBtn');
    const btnVerify = document.getElementById('verifyOtpBtn');
    const btnResend = document.getElementById('resendOtpBtn');
    const btnBack = document.getElementById('backToEmailBtn');
    const emailHint = document.getElementById('emailHint');
    const otpHint = document.getElementById('otpHint');

    // 🛡️ 防刷冷却倒计时
    const startCooldown = (btn, originalText, seconds = 60) => {
        let count = seconds;
        btn.disabled = true;
        
        const tpl = window.t ? window.t('auth_resend_cooldown') : "未收到？{s}s 后可重发";
        btn.textContent = tpl.replace('{s}', count);

        const timer = setInterval(() => {
            count--;
            btn.textContent = tpl.replace('{s}', count);
            if (count <= 0) {
                clearInterval(timer);
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }, 1000);
    };

    // 1. 发送验证码逻辑（带防刷）
    const doSendOtp = async () => {
        if (btnSend.disabled) return;
        const email = emailInput.value.trim();
        
        if (!email || !email.includes('@')) {
            if (emailHint) { emailHint.textContent = window.t ? window.t('auth_invalid_email') : '请输入有效的邮箱地址'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
            return;
        }

        btnSend.disabled = true;
        btnSend.textContent = '...';
        if (emailHint) emailHint.style.display = 'none';

        try {
            const res = await sendOTP(email);
            if (res.ok) {
                showAuthStep('otp');
                document.getElementById('sentEmail').textContent = email;
                startCooldown(btnResend, window.t ? window.t('auth_resend') : '重新发送验证码', 60);
            } else {
                // 🌟 核心优化：如果触发了限流，直接跳转到输入验证码界面！
                // 因为用户大概率在之前的 60 秒内已经收到了验证码。
                if (res.error && (res.error.includes('频繁') || res.error.includes('limit'))) {
                    // 🌟 严格按照逻辑：两边验证码独立，直接提示限流
                    if (emailHint) { 
                        emailHint.textContent = window.t ? window.t('auth_rate_limit') : '登录太频繁，请稍后重试。'; 
                        emailHint.style.color = '#f85149'; 
                        emailHint.style.display = 'block'; 
                    }
                    btnSend.disabled = false;
                    btnSend.textContent = window.t ? window.t('auth_send_otp') : '发送验证码';
                } else {
                    if (emailHint) { emailHint.textContent = res.error || '发送失败'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
                    btnSend.disabled = false;
                    btnSend.textContent = window.t ? window.t('auth_send_otp') : '发送验证码';
                }
            }
        } catch (e) {
            if (emailHint) { emailHint.textContent = window.t ? window.t('auth_network_error') : '网络异常'; emailHint.style.color = '#f85149'; emailHint.style.display = 'block'; }
            btnSend.disabled = false;
            btnSend.textContent = window.t ? window.t('auth_send_otp') : '发送验证码';
        }
    };

    // 2. 验证 OTP 逻辑
    const doVerifyOtp = async () => {
        if (btnVerify.disabled) return;
        const otp = otpInput.value.trim();
        
        if (otp.length !== 8) {
            if (otpHint) { 
                otpHint.textContent = window.t ? window.t('auth_invalid_otp') : '请输入 8 位验证码'; 
                otpHint.style.color = '#f85149'; 
                otpHint.style.display = 'block'; 
            }
            return;
        }

        btnVerify.disabled = true;
        btnVerify.textContent = window.t ? window.t('auth_verifying') : '验证中...';
        if (otpHint) otpHint.style.display = 'none';

        try {
            const email = document.getElementById('sentEmail').textContent;
            const res = await verifyOTP(email, otp);

            if (res.ok) {
                // 等待全局同步完成
                if (typeof window.syncUserState === 'function') {
                    await window.syncUserState();
                }
                
                // 如果设备满了，syncUserState 会设置 _deviceLimitReached，此时绝不能渲染已登录界面
                if (window._deviceLimitReached) {
                    // 🚀 核心修复：直接终止，把舞台交给弹窗
                    btnVerify.disabled = false;
                    btnVerify.textContent = window.t ? window.t('auth_verify') : '验证';
                    return; 
                }

                const user = await getCurrentUser();
                if (user) {
                    showAuthStep('logged-in');
                    renderLoggedInView(user);
                }
            } else {
                if (otpHint) { otpHint.textContent = res.error || '验证失败，请检查验证码'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
                btnVerify.disabled = false;
                btnVerify.textContent = window.t ? window.t('auth_verify') : '验证';
            }
        } catch (e) {
            if (otpHint) { otpHint.textContent = window.t ? window.t('auth_network_error') : '网络异常，请稍后再试'; otpHint.style.color = '#f85149'; otpHint.style.display = 'block'; }
            btnVerify.disabled = false;
            btnVerify.textContent = window.t ? window.t('auth_verify') : '验证';
        }
    };

    // 3. 绑定点击事件
    if (btnSend) btnSend.onclick = doSendOtp;
    if (btnVerify) btnVerify.onclick = doVerifyOtp;
    if (btnBack) btnBack.onclick = () => showAuthStep('email');

    // 4. 绑定 Enter 键与自动提交
    if (emailInput) {
        emailInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doSendOtp(); } };
    }
    if (otpInput) {
        otpInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doVerifyOtp(); } };
        
        // 🌟 高端体验：粘贴或输入满 8 位，自动过滤非数字并提交
        otpInput.oninput = (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
            if (e.target.value.length === 8 && !btnVerify.disabled) {
                setTimeout(() => doVerifyOtp(), 100);
            }
        };
    }

    // 5. 重发按钮
    if (btnResend) {
        btnResend.onclick = async () => {
            if (btnResend.disabled) return;
            
            const orig = window.t ? window.t('auth_resend') : '重新发送验证码';
            btnResend.disabled = true;
            btnResend.textContent = '...';
            
            try {
                const email = document.getElementById('sentEmail').textContent;
                const res = await sendOTP(email);
                if (res.ok) {
                    startCooldown(btnResend, orig, 60);
                } else {
                    alert(res.error || '发送失败');
                    btnResend.disabled = false;
                    btnResend.textContent = orig;
                }
            } catch (e) {
                btnResend.disabled = false;
                btnResend.textContent = orig;
            }
        };
    }

    // ==========================================
    // 🚀 Google OAuth 登录逻辑 (强制 Native Implicit Flow)
    // ==========================================
    const googleBtn = document.getElementById('googleLoginBtn');
    // 🛡️ 优雅降级：如果当前环境不支持 identity (如 Whale 浏览器)，则隐藏 Google 登录按钮
    if (googleBtn) {
        if (!chrome.identity) {
            googleBtn.style.display = 'none';
            const divider = document.querySelector('.auth-divider');
            if (divider) divider.style.display = 'none';
        } else {
        googleBtn.onclick = () => {
            const supabaseUrl = 'https://uvbaioqqjqseapcancvi.supabase.co';
            const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2YmFpb3FxanFzZWFwY2FuY3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0OTIyODAsImV4cCI6MjEwODA2ODI4MH0.jhEaDHBvp702biC7oqM1oV5YO7rzhvmXFH5pTRF17kQ';

            // 1. 获取地址并打印
            const redirectUrl = chrome.identity.getRedirectURL();
            console.log("==========================================");
            console.log("🚨 [诊断点 1] 插件回调地址:", redirectUrl);
            
            // 🌟 核心修复：手动拼接 URL，强制加上 response_type=token 和 prompt=select_account
            const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUrl)}&response_type=token&prompt=select_account`;
            
            console.log("🚨 [诊断点 2] 强制生成的授权 URL:");
            console.log("👉", authUrl);
            console.log("==========================================");

            googleBtn.disabled = true;
            const originalHTML = googleBtn.innerHTML;
            googleBtn.innerHTML = window.t ? window.t('auth_google_loading') : 'Loading...';
            if (emailHint) emailHint.style.display = 'none';

            chrome.identity.launchWebAuthFlow({
                url: authUrl,
                interactive: true
            }, async (responseUrl) => {
                if (chrome.runtime.lastError || !responseUrl) {
                    console.error('🚨 [诊断点 3] 登录失败或取消:', chrome.runtime.lastError?.message);
                    googleBtn.disabled = false;
                    googleBtn.innerHTML = originalHTML;
                    return;
                }

                console.log("🚨 [诊断点 3] 弹窗最终跳回的 URL:");
                console.log("👉", responseUrl);
                console.log("==========================================");

                try {
                    const urlParams = new URLSearchParams(new URL(responseUrl).hash.substring(1));
                    const accessToken = urlParams.get('access_token');
                    const refreshToken = urlParams.get('refresh_token');

                    if (!accessToken) {
                        throw new Error('未获取到 access_token，请检查上面打印的诊断点 3 的 URL');
                    }

                    // 获取用户信息
                    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
                        headers: {
                            'apikey': supabaseKey,
                            'Authorization': `Bearer ${accessToken}`
                        }
                    });

                    if (!userRes.ok) throw new Error('获取用户信息失败');
                    const user = await userRes.json();

                    // 保存到本地 Storage
                    await chrome.storage.local.set({
                        dewsecure_user: {
                            token: accessToken,
                            refreshToken: refreshToken,
                            email: user.email,
                            id: user.id,
                            tier: 'free'
                        }
                    });

                    if (typeof window.syncUserState === 'function') {
                        await window.syncUserState();
                    }

                    showAuthStep('logged-in');
                    renderLoggedInView(user);

                } catch (err) {
                    console.error('🚨 [诊断点 4] 解析异常:', err);
                    if (emailHint) {
                        emailHint.textContent = '登录处理失败: ' + err.message;
                        emailHint.style.color = '#f85149';
                        emailHint.style.display = 'block';
                    }
                } finally {
                    googleBtn.disabled = false;
                    googleBtn.innerHTML = originalHTML;
                }
            });
        };
        }
    }
}
