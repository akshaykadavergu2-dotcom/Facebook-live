package com.livecast.capture

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.livecast.capture.databinding.ActivityMainBinding
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            launchCaptureService(result.resultCode, result.data!!)
        } else {
            binding.tvPermissionStatus.text = "Capture Permission: Denied by user"
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        requestScreenCapturePermission()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        applyDeepLinkIntent(intent)

        binding.btnConnectBackend.setOnClickListener {
            connectToBackendOnly()
        }

        binding.btnStartCapture.setOnClickListener {
            checkPermissionsAndStartCapture()
        }

        binding.btnStopCapture.setOnClickListener {
            val stopIntent = Intent(this, CaptureForegroundService::class.java).apply {
                action = CaptureForegroundService.ACTION_STOP_CAPTURE
            }
            startService(stopIntent)
        }

        observeServiceState()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyDeepLinkIntent(intent)
    }

    private fun applyDeepLinkIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "livecast" && data.host == "capture") {
            data.getQueryParameter("backend")?.let { binding.etBackendUrl.setText(it) }
            data.getQueryParameter("sessionId")?.let { binding.etSessionId.setText(it) }
            data.getQueryParameter("token")?.let { binding.etIngestToken.setText(it) }
            data.getQueryParameter("yt")?.let { binding.etYoutubeUrl.setText(it) }
        }
    }

    private fun observeServiceState() {
        lifecycleScope.launch {
            CaptureForegroundService.uiState.collect { state ->
                binding.tvLiveIndicator.visibility =
                    if (state.videoStatus == VideoCaptureStatus.CAPTURING) View.VISIBLE else View.GONE

                binding.tvPermissionStatus.text =
                    "Capture Permission: ${if (state.permissionGranted) "Granted" else "Not Granted"}"
                binding.tvConnectionStatus.text =
                    "Backend Connection: ${state.connectionStatus.name}"
                binding.tvVideoStatus.text =
                    "Video Status: ${state.videoStatus.name}"
                binding.tvAudioStatus.text =
                    "Audio Status: ${state.audioStatus.name}"
                binding.tvStreamMetrics.text =
                    "Metrics: ${state.fps} fps · ${state.width}x${state.height} · ${state.audioSampleRate} Hz · ${state.latencyMs} ms"

                if (!state.lastError.isNullOrBlank()) {
                    binding.tvErrorBanner.visibility = View.VISIBLE
                    binding.tvErrorBanner.text = state.lastError
                } else {
                    binding.tvErrorBanner.visibility = View.GONE
                }
            }
        }

        lifecycleScope.launch {
            CaptureForegroundService.remoteStartRequest.collect { ytUrl ->
                if (ytUrl != null) {
                    if (ytUrl.isNotBlank()) {
                        binding.etYoutubeUrl.setText(ytUrl)
                    }
                    CaptureForegroundService.clearRemoteStartRequest()
                    checkPermissionsAndStartCapture()
                }
            }
        }
    }

    private fun connectToBackendOnly() {
        val intent = Intent(this, CaptureForegroundService::class.java).apply {
            action = CaptureForegroundService.ACTION_CONNECT_ONLY
            putExtra(CaptureForegroundService.EXTRA_BACKEND_URL, binding.etBackendUrl.text.toString().trim())
            putExtra(CaptureForegroundService.EXTRA_SESSION_ID, binding.etSessionId.text.toString().trim())
            putExtra(CaptureForegroundService.EXTRA_INGEST_TOKEN, binding.etIngestToken.text.toString().trim())
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun checkPermissionsAndStartCapture() {
        val missing = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            missing.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        } else {
            requestScreenCapturePermission()
        }
    }

    private fun requestScreenCapturePermission() {
        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mgr.createScreenCaptureIntent())
    }

    private fun launchCaptureService(resultCode: Int, data: Intent) {
        val ytUrl = binding.etYoutubeUrl.text.toString().trim()
        val serviceIntent = Intent(this, CaptureForegroundService::class.java).apply {
            action = CaptureForegroundService.ACTION_START_CAPTURE
            putExtra(CaptureForegroundService.EXTRA_BACKEND_URL, binding.etBackendUrl.text.toString().trim())
            putExtra(CaptureForegroundService.EXTRA_SESSION_ID, binding.etSessionId.text.toString().trim())
            putExtra(CaptureForegroundService.EXTRA_INGEST_TOKEN, binding.etIngestToken.text.toString().trim())
            putExtra(CaptureForegroundService.EXTRA_YOUTUBE_URL, ytUrl)
            putExtra(CaptureForegroundService.EXTRA_RESULT_CODE, resultCode)
            putExtra(CaptureForegroundService.EXTRA_RESULT_DATA, data)
        }
        ContextCompat.startForegroundService(this, serviceIntent)

        // Open dedicated Monitor A stage immediately so MediaProjection captures ONLY Monitor A
        val monitorIntent = Intent(this, MonitorACaptureActivity::class.java).apply {
            putExtra(MonitorACaptureActivity.EXTRA_YOUTUBE_URL, ytUrl)
        }
        startActivity(monitorIntent)
    }
}
