package com.livecast.capture

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hardware/AndroidKeyStore-backed AES-256-GCM credential vault for RTMP server URLs,
 * stream keys, and backend endpoints. Never logs raw secrets.
 */
class SecureCredentialStore(context: Context) {

    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "livecast_studio_vault_aes"
        private const val PREFS_NAME = "livecast_secure_vault"
        private const val GCM_TAG_BITS = 128

        const val DEFAULT_BACKEND_URL = "https://facebook-live-gvx5.onrender.com"
        const val DEFAULT_FB_RTMP = "rtmps://live-api-s.facebook.com:443/rtmp/"
        const val DEFAULT_YT_RTMP = "rtmps://a.rtmps.youtube.com:443/live2"

        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_FB_SERVER = "fb_server_url"
        private const val KEY_FB_KEY_ENC = "fb_stream_key_enc"
        private const val KEY_YT_SERVER = "yt_server_url"
        private const val KEY_YT_KEY_ENC = "yt_stream_key_enc"
        private const val KEY_LAST_INTRO_MS = "last_intro_shown_ms"
    }

    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = ks.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(1 + iv.size + ct.size)
        combined[0] = iv.size.toByte()
        System.arraycopy(iv, 0, combined, 1, iv.size)
        System.arraycopy(ct, 0, combined, 1 + iv.size, ct.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String?): String {
        if (encoded.isNullOrBlank()) return ""
        return try {
            val combined = Base64.decode(encoded, Base64.NO_WRAP)
            if (combined.size < 14) return ""
            val ivLen = combined[0].toInt() and 0xFF
            if (combined.size <= 1 + ivLen) return ""
            val iv = combined.copyOfRange(1, 1 + ivLen)
            val ct = combined.copyOfRange(1 + ivLen, combined.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (_: Exception) {
            ""
        }
    }

    fun getBackendUrl(): String =
        prefs.getString(KEY_BACKEND_URL, DEFAULT_BACKEND_URL).orEmpty().ifBlank { DEFAULT_BACKEND_URL }

    fun setBackendUrl(url: String) {
        prefs.edit().putString(KEY_BACKEND_URL, url.trim().trimEnd('/')).apply()
    }

    fun getFacebookServerUrl(): String =
        prefs.getString(KEY_FB_SERVER, DEFAULT_FB_RTMP).orEmpty().ifBlank { DEFAULT_FB_RTMP }

    fun getFacebookStreamKey(): String = decrypt(prefs.getString(KEY_FB_KEY_ENC, null))

    fun saveFacebookCredentials(serverUrl: String, streamKey: String?) {
        val editor = prefs.edit().putString(KEY_FB_SERVER, serverUrl.trim())
        if (!streamKey.isNullOrBlank()) {
            editor.putString(KEY_FB_KEY_ENC, encrypt(streamKey.trim()))
        }
        editor.apply()
    }

    fun clearFacebookStreamKey() {
        prefs.edit().remove(KEY_FB_KEY_ENC).apply()
    }

    fun getYoutubeServerUrl(): String =
        prefs.getString(KEY_YT_SERVER, DEFAULT_YT_RTMP).orEmpty().ifBlank { DEFAULT_YT_RTMP }

    fun getYoutubeStreamKey(): String = decrypt(prefs.getString(KEY_YT_KEY_ENC, null))

    fun saveYoutubeCredentials(serverUrl: String, streamKey: String?) {
        val editor = prefs.edit().putString(KEY_YT_SERVER, serverUrl.trim())
        if (!streamKey.isNullOrBlank()) {
            editor.putString(KEY_YT_KEY_ENC, encrypt(streamKey.trim()))
        }
        editor.apply()
    }

    fun clearYoutubeStreamKey() {
        prefs.edit().remove(KEY_YT_KEY_ENC).apply()
    }

    fun shouldShowSplashIntro(cooldownMs: Long = 10 * 60 * 1000L): Boolean {
        val last = prefs.getLong(KEY_LAST_INTRO_MS, 0L)
        return (System.currentTimeMillis() - last) >= cooldownMs
    }

    fun markSplashIntroShown() {
        prefs.edit().putLong(KEY_LAST_INTRO_MS, System.currentTimeMillis()).apply()
    }
}
