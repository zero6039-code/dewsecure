package com.dewsecure.android.ui

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.os.CountDownTimer
import android.util.Log
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.lifecycle.lifecycleScope
import com.dewsecure.android.R
import com.dewsecure.android.policy.AuthManager
import kotlinx.coroutines.launch
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64

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

        // 🌟 修复：inset 加到带 bg_aurora 的根布局，消除状态栏/导航栏白条
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetRoot = (findViewById<android.view.View>(android.R.id.content) as android.view.ViewGroup).getChildAt(0)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(insetRoot) { v, ins ->
            val bars = ins.getInsetsIgnoringVisibility(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            v.setPadding(v.paddingLeft, bars.top, v.paddingRight, bars.bottom)
            ins
        }

        initViews()
        setupListeners()
        updateUI()

        handleDeepLink(intent)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // 🌟 语言变化时，手动刷新所有 UI 文本
        updateUI()
    }

    private fun updateUI() {
        // 🌟 因为缺失 activity_login.xml 的 ID 支持，我们暂时只刷新代码里已经绑定好的 View
        // 等你把 activity_login.xml 发给我，我再把标题、副标题等硬编码加上 ID 并完美刷新
        etEmail.hint = getString(R.string.login_email_hint)
        btnSendOtp.text = getString(R.string.login_btn_send_otp)
        btnVerifyOtp.text = getString(R.string.login_btn_verify)
        btnBackEmail.text = getString(R.string.login_btn_back)
        btnResendOtp.text = getString(R.string.login_resend)
        
        if (tvSentEmail.text.isNotEmpty()) {
            tvSentEmail.text = getString(R.string.login_otp_sent_to, currentEmail)
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: Intent?) {
        val data: Uri = intent?.data ?: return
        // A-05 修复：清空 Intent 防重放
        intent.data = null
        setIntent(Intent())
        
        if (data.scheme == DEEP_LINK_SCHEME && data.host == DEEP_LINK_HOST) {
            val code = data.getQueryParameter("code") ?: return
            val verifier = PendingLogin.consume(this) ?: run {
                Toast.makeText(this, getString(R.string.toast_google_fail_token), Toast.LENGTH_LONG).show()
                return
            }
            
            lifecycleScope.launch {
                val tokenResult = AuthManager.exchangeCodeForSession(code, verifier)
                if (tokenResult.isSuccess) {
                    val (accessToken, refreshToken) = tokenResult.getOrNull()!!
                    val userResult = AuthManager.getUserInfo(accessToken)
                    var realEmail = getString(R.string.error_unknown_user)
                    if (userResult.isSuccess) {
                        realEmail = userResult.getOrNull()?.optString("email") ?: getString(R.string.error_unknown_user)
                    }

                    val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
                    prefs.edit()
                        .putString("access_token", accessToken)
                        .putString("refresh_token", refreshToken)
                        .putString("email", realEmail)
                        .apply()

                    Toast.makeText(this@LoginActivity, getString(R.string.toast_google_success), Toast.LENGTH_SHORT).show()
                    startActivity(Intent(this@LoginActivity, AccountActivity::class.java))
                    finish()
                } else {
                    Toast.makeText(this@LoginActivity, getString(R.string.toast_google_fail_token), Toast.LENGTH_LONG).show()
                }
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

        findViewById<View>(R.id.btn_google_login).setOnClickListener {
            val supabaseUrl = "https://uvbaioqqjqseapcancvi.supabase.co"
            val redirectUrl = "$DEEP_LINK_SCHEME://$DEEP_LINK_HOST"
            
            val verifier = Pkce.verifier().also { PendingLogin.save(this, it) }
            val challenge = Pkce.challenge(verifier)
            
            val authUrl = "$supabaseUrl/auth/v1/authorize?provider=google&redirect_to=$redirectUrl&response_type=code&code_challenge=$challenge&code_challenge_method=s256"

            try {
                val customTabsIntent = CustomTabsIntent.Builder().build()
                customTabsIntent.launchUrl(this, Uri.parse(authUrl))
            } catch (e: Exception) {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(authUrl))
                startActivity(intent)
            }
            Toast.makeText(this, getString(R.string.toast_google_redirect), Toast.LENGTH_SHORT).show()
        }
    }

    private fun doSendOtp() {
        val email = etEmail.text.toString().trim()
        if (!email.contains("@")) {
            showError(tvEmailError, getString(R.string.error_invalid_email))
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
                tvSentEmail.text = getString(R.string.login_otp_sent_to, email)
                etOtp.text.clear()
                startCooldown()
            } else {
                showError(tvEmailError, result.exceptionOrNull()?.message ?: getString(R.string.error_send_fail))
                btnSendOtp.isEnabled = true
                btnSendOtp.text = getString(R.string.login_btn_send_otp)
            }
        }
    }

    private fun doVerifyOtp() {
        val otp = etOtp.text.toString().trim()
        if (otp.length != 8) {
            showError(tvOtpError, getString(R.string.error_invalid_otp))
            return
        }

        btnVerifyOtp.isEnabled = false
        btnVerifyOtp.text = "..."
        tvOtpError.visibility = View.GONE

        lifecycleScope.launch {
            val result = AuthManager.verifyOTP(currentEmail, otp)
            if (result.isSuccess) {
                val (accessToken, refreshToken) = result.getOrNull()!!

                Toast.makeText(this@LoginActivity, getString(R.string.toast_login_success), Toast.LENGTH_SHORT).show()

                val prefs = getSharedPreferences("user_session", Context.MODE_PRIVATE)
                prefs.edit()
                    .putString("access_token", accessToken)
                    .putString("refresh_token", refreshToken)
                    .putString("email", currentEmail)
                    .apply()

                startActivity(Intent(this@LoginActivity, AccountActivity::class.java))
                finish()
            } else {
                showError(tvOtpError, result.exceptionOrNull()?.message ?: getString(R.string.error_verify_fail))
                btnVerifyOtp.isEnabled = true
                btnVerifyOtp.text = getString(R.string.login_btn_verify)
            }
        }
    }

    private fun startCooldown() {
        btnSendOtp.isEnabled = true
        btnSendOtp.text = getString(R.string.login_btn_send_otp)

        btnResendOtp.isEnabled = false
        countDownTimer?.cancel()
        countDownTimer = object : CountDownTimer(60000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                btnResendOtp.text = getString(R.string.login_resend_in, (millisUntilFinished / 1000).toInt())
                btnResendOtp.setTextColor(getColor(R.color.text_secondary))
            }
            override fun onFinish() {
                btnResendOtp.isEnabled = true
                btnResendOtp.text = getString(R.string.login_resend)
                btnResendOtp.setTextColor(getColor(R.color.accent_blue))
            }
        }.start()
    }

    private fun cancelTimer() {
        countDownTimer?.cancel()
        btnResendOtp.isEnabled = true
        btnResendOtp.text = getString(R.string.login_resend)
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


object Pkce {
    private const val F = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    fun verifier(): String = ByteArray(32).also { SecureRandom().nextBytes(it) }.let { Base64.encodeToString(it, F) }
    fun challenge(v: String): String = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(v.toByteArray(Charsets.US_ASCII)), F)
}

object PendingLogin {
    private const val PREF_NAME = "pending_login"
    private const val KEY_VERIFIER = "verifier"
    fun save(context: Context, verifier: String) {
        context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit().putString(KEY_VERIFIER, verifier).apply()
    }
    fun consume(context: Context): String? {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val v = prefs.getString(KEY_VERIFIER, null)
        prefs.edit().remove(KEY_VERIFIER).apply()
        return v
    }
}
