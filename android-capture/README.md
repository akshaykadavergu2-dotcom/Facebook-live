# LIVECAST STUDIO — All-in-One Android Broadcast Studio (`v2.0.0`)

Native Kotlin broadcasting application for **LIVECAST STUDIO** (`com.livecast.capture`, Android SDK 35, JDK 17, Gradle 8.10.2).

## Key Capabilities
- **Cinematic Opening Intro**: 60 FPS animated studio splash (`SplashIntroActivity` / `SplashIntroView`) with signal/sound waves, particles, and Skip Intro + cooldown.
- **TV Broadcast Control Room UI**: 6-tab custom animated bottom navigation (`Home`, `Studio`, `Preview`, `Mixer`, `Output`, `Settings`).
- **YouTube Preview + Error 152-4 Fix**: Official YouTube IFrame Player API loaded via `https://streamkarolive.netlify.app/` with `Referrer-Policy: strict-origin-when-cross-origin`, third-party cookies enabled, and `Open in YouTube` fallback.
- **Monitor A Dedicated Capture**: `MonitorACaptureActivity` + `MediaProjection` + H.264 `MediaCodec` (`ScreenVideoEncoder`) streaming over `wss://.../ws/capture-ingest`.
- **Dual-Channel Audio Mixer**: Independent ON/OFF, Mute, and `0–150%` Volume for Internal Playback Capture (`AudioPlaybackCapture`) + Live Microphone (`VOICE_COMMUNICATION` + AEC) + Master Bus + live waveform & peak meters (`AudioMixerEngine`).
- **Interactive Overlay Studio**: Touch-draggable 16:9 canvas (`DraggableOverlayCanvasView`) + PNG logo & custom image upload + live clock, headline, breaking news, lower third, custom text, and scrolling ticker synced to FFmpeg.
- **Multi-Destination RTMP Output**: Independent or simultaneous streaming to **Facebook Live** and **YouTube Live** RTMPS with fault isolation and per-platform telemetry.
- **Hardware-Backed Vault**: `AndroidKeyStore` AES-256-GCM credential storage (`SecureCredentialStore`) + server-side AES-256-GCM encryption.

## Cloud APK Build (No Computer Required)
1. Push changes to GitHub.
2. GitHub Actions workflow `.github/workflows/android-apk.yml` automatically installs Android SDK 35, runs `:app:testDebugUnitTest`, builds the signed debug APK, and publishes it to:
   - `public/downloads/livecast-companion.apk`
   - `public/downloads/apk-metadata.json`
   - GitHub Actions Artifact `livecast-android-capture-debug-apk`
3. Download directly from `https://streamkarolive.netlify.app/downloads/livecast-companion.apk`.
