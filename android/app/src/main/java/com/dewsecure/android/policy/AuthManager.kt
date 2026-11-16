package com.dewsecure.android.policy

import android.content.Context
import org.json.JSONObject

// 🚀 A-07 重构：AuthManager 作为门面，统一接管外部调用，内部转发给底层独立模块
object AuthManager {
    const val SUPABASE_URL = SessionManager.SUPABASE_URL
    const val SUPABASE_KEY = SessionManager.SUPABASE_KEY

    suspend fun refreshToken(context: Context): Result<String> = SessionManager.refreshToken(context)
    suspend fun getUserInfo(accessToken: String): Result<JSONObject> = AuthApi.getUserInfo(accessToken)
    suspend fun exchangeCodeForSession(code: String, verifier: String): Result<Pair<String, String>> = AuthApi.exchangeCodeForSession(code, verifier)
    suspend fun sendOTP(email: String): Result<Unit> = AuthApi.sendOTP(email)
    suspend fun verifyOTP(email: String, token: String): Result<Pair<String, String>> = AuthApi.verifyOTP(email, token)
    suspend fun fetchCloudWhitelist(context: Context, accessToken: String): Result<List<String>> = WhitelistManager.fetchCloudWhitelist(context, accessToken)
    suspend fun uploadWhitelistDomain(context: Context, accessToken: String, domain: String): Result<Unit> = WhitelistManager.uploadWhitelistDomain(context, accessToken, domain)
    suspend fun deleteCloudWhitelistDomain(context: Context, accessToken: String, domain: String): Result<Unit> = WhitelistManager.deleteCloudWhitelistDomain(context, accessToken, domain)
    suspend fun submitReport(context: Context, type: String, domain: String): Result<Unit> = WhitelistManager.submitReport(context, type, domain)
    fun getUserIdFromToken(token: String): String? = SessionManager.getUserIdFromToken(token)
    suspend fun fetchUserProfile(context: Context, force: Boolean = false): Result<String> = ProfileManager.fetchUserProfile(context, force)
    suspend fun logout(context: Context): Result<Unit> = AuthApi.logout(context)
    suspend fun getHandoffCode(context: Context): Result<String> = AuthApi.getHandoffCode(context)
}
