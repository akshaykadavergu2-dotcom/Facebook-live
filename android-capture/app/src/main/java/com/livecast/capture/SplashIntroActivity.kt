package com.livecast.capture

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import com.livecast.capture.databinding.ActivitySplashIntroBinding
import com.livecast.capture.studio.ui.StudioHomeActivity

/**
 * Broadcast opening intro screen (~3.5s) with Skip Intro button and smart cooldown.
 * App links continue to open the existing capture studio directly.
 */
class SplashIntroActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_FORCE_PLAY = "extra_force_play"
    }

    private lateinit var binding: ActivitySplashIntroBinding
    private var navigated = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val isDeepLink = intent?.data != null
        val forcePlay = intent?.getBooleanExtra(EXTRA_FORCE_PLAY, false) == true
        val store = SecureCredentialStore(this)

        if (isDeepLink) {
            forwardToMain()
            return
        }
        if (!forcePlay && !store.shouldShowSplashIntro()) {
            forwardToStudio()
            return
        }

        binding = ActivitySplashIntroBinding.inflate(layoutInflater)
        setContentView(binding.root)
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )

        store.markSplashIntroShown()

        binding.btnSkipIntro.setOnClickListener {
            binding.splashIntroView.cancelAnimation()
            forwardToStudio()
        }

        binding.splashIntroView.startAnimation(durationMs = 3500L) {
            forwardToStudio()
        }
    }

    private fun forwardToStudio() {
        if (navigated || isFinishing) return
        navigated = true
        startActivity(Intent(this, StudioHomeActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
        })
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    private fun forwardToMain() {
        if (navigated || isFinishing) return
        navigated = true
        val target = Intent(this, MainActivity::class.java).apply {
            action = intent?.action
            data = intent?.data
            intent?.extras?.let { putExtras(it) }
            addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
        }
        startActivity(target)
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }
}
