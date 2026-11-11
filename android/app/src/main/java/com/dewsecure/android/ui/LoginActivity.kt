package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CountDownTimer
import android.util.Log
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var stepEmail: LinearLayout
    private lateinit var stepOtp: LinearLayout
    private lateinit var etEmail: EditText
    private lateinit var etOtp: EditText
    private lateinit var btnSendOtp: Button
    private lateinit var btnVerifyOtp: Button
    private lateinit var btnResendOtp: TextView
    private lateinit var btnBackEmail: TextView
    private lateinit var tvSentEmail: TextView
    private lateinit var tvEmailError: TextView
    private lateinit var tvOtpError: TextView

    private var currentEmail = ""
    private var countDownTimer: CountDownTimer? = null

    companion object {
        private const val TAG = "LoginActivity"
        private const val DEEP_LINK_SCHEME = "com.dewsecure.android"
        private const val DEEP_LINK_HOST = "login-callback"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        initViews()
        setupListeners()

        // 处理如果 App 被杀死后，由浏览器直接冷启动的情况
        handleDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        // 处理 App 在后台时，浏览器唤起的回调
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val data: Uri = intent?.data ?: return
        if (data.scheme == DEEP_LINK_SCHEME && data.host == DEEP_LINK_HOST) {
            Log.i(TAG, "收到登录回调: $data")
            val fragment = data.fragment ?: return
            val params = fragment.split("&").associate {
                val parts = it.split("=")
                if (parts.size == 2) parts[0] to parts[1] else "" to ""
            }

            val accessToken = params["access_token"]
            val refreshToken = params["refresh_token"]

            if (!accessToken.isNullOrEmpty()) {
                // 异步获取真实的 Google 用户邮箱
                lifecycleScope.launch {
                    val userResult = AuthManager.getUserInfo(accessToken)
                    var realEmail = "未知用户"
                    if (userResult.isSuccess) {
                        realEmail = userResult.getOrNull()?.optString("email") ?: "未知用户"
                    }

                    val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
                    prefs.edit()
                        .putString("access_token", accessToken)
                        .putString("refresh_token", refreshToken) // 保存 refresh_token 用于自动续期
                        .putString("email", realEmail)
                        .apply()

                    Toast.makeText(this@LoginActivity, "Google 登录成功！", Toast.LENGTH_SHORT).show()
                    startActivity(Intent(this@LoginActivity, AccountActivity::class.java))
                    finish()
                }
            } else {
                Log.e(TAG, "回调中未找到 access_token")
                Toast.makeText(this, "登录失败：缺少 Token", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun initViews() {
        findViewById<ImageView>(R.id.btn_close).setOnClickListener { finish() }

        stepEmail = findViewById(R.id.step_email)
        stepOtp = findViewById(R.id.step_otp)
        etEmail = findViewById(R.id.et_email)
        etOtp = findViewById(R.id.et_otp)
        btnSendOtp = findViewById(R.id.btn_send_otp)
        btnVerifyOtp = findViewById(R.id.btn_verify_otp)
        btnResendOtp = findViewById(R.id.btn_resend_otp)
        btnBackEmail = findViewById(R.id.btn_back_email)
        tvSentEmail = findViewById(R.id.tv_sent_email)
        tvEmailError = findViewById(R.id.tv_email_error)
        tvOtpError = findViewById(R.id.tv_otp_error)
    }

    private fun setupListeners() {
        btnSendOtp.setOnClickListener { doSendOtp() }
        btnVerifyOtp.setOnClickListener { doVerifyOtp() }
        btnBackEmail.setOnClickListener {
            cancelTimer()
            stepOtp.visibility = View.GONE
            stepEmail.visibility = View.VISIBLE
        }
        btnResendOtp.setOnClickListener {
            if (btnResendOtp.isEnabled) doSendOtp()
        }

        etOtp.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                if (s?.length == 8 && btnVerifyOtp.isEnabled) {
                    doVerifyOtp()
                }
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })

        // Google 登录跳转
        findViewById<View>(R.id.btn_google_login).setOnClickListener {
            val supabaseUrl = "https://uvbaioqqjqseapcancvi.supabase.co"
            val redirectUrl = "$DEEP_LINK_SCHEME://$DEEP_LINK_HOST"
            val authUrl = "$supabaseUrl/auth/v1/authorize?provider=google&redirect_to=$redirectUrl&response_type=token"

            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(authUrl))
            startActivity(intent)
            Toast.makeText(this, "正在跳转 Google 登录...", Toast.LENGTH_SHORT).show()
        }
    }

    private fun doSendOtp() {
        val email = etEmail.text.toString().trim()
        if (!email.contains("@")) {
            showError(tvEmailError, "请输入有效的邮箱地址")
            return
        }

        currentEmail = email
        btnSendOtp.isEnabled = false
        btnSendOtp.text = "..."
        tvEmailError.visibility = View.GONE

        lifecycleScope.launch {
            val result = AuthManager.sendOTP(email)
            if (result.isSuccess) {
                stepEmail.visibility = View.GONE
                stepOtp.visibility = View.VISIBLE
                tvSentEmail.text = email
                etOtp.text.clear()
                startCooldown()
            } else {
                showError(tvEmailError, result.exceptionOrNull()?.message ?: "发送失败")
                btnSendOtp.isEnabled = true
                btnSendOtp.text = "Send OTP"
            }
        }
    }

    private fun doVerifyOtp() {
        val otp = etOtp.text.toString().trim()
        if (otp.length != 8) {
            showError(tvOtpError, "请输入 8 位验证码")
            return
        }

        btnVerifyOtp.isEnabled = false
        btnVerifyOtp.text = "验证中..."
        tvOtpError.visibility = View.GONE

        lifecycleScope.launch {
            // 现在 verifyOTP 返回的是 Pair<access_token, refresh_token>
            val result = AuthManager.verifyOTP(currentEmail, otp)
            if (result.isSuccess) {
                val (accessToken, refreshToken) = result.getOrNull()!!
                
                Toast.makeText(this@LoginActivity, "登录成功！", Toast.LENGTH_SHORT).show()

                val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
                prefs.edit()
                    .putString("access_token", accessToken)
                    .putString("refresh_token", refreshToken) // 保存 refresh_token
                    .putString("email", currentEmail)
                    .apply()

                startActivity(Intent(this@LoginActivity, AccountActivity::class.java))
                finish()
            } else {
                showError(tvOtpError, result.exceptionOrNull()?.message ?: "验证失败")
                btnVerifyOtp.isEnabled = true
                btnVerifyOtp.text = "Verify"
            }
        }
    }

    private fun startCooldown() {
        btnSendOtp.isEnabled = true
        btnSendOtp.text = "Send OTP"

        btnResendOtp.isEnabled = false
        countDownTimer?.cancel()
        countDownTimer = object : CountDownTimer(60000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                btnResendOtp.text = "${millisUntilFinished / 1000}s 后可重发"
                btnResendOtp.setTextColor(getColor(R.color.text_secondary))
            }
            override fun onFinish() {
                btnResendOtp.isEnabled = true
                btnResendOtp.text = "重新发送验证码"
                btnResendOtp.setTextColor(getColor(R.color.accent_blue))
            }
        }.start()
    }

    private fun cancelTimer() {
        countDownTimer?.cancel()
        btnResendOtp.isEnabled = true
        btnResendOtp.text = "重新发送验证码"
    }

    private fun showError(textView: TextView, msg: String) {
        textView.text = msg
        textView.visibility = View.VISIBLE
    }

    override fun onDestroy() {
        super.onDestroy()
        cancelTimer()
    }
}
