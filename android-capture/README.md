# LIVECAST STUDIO — Android Native Live Capture Companion App (`/android-capture`)

## Architecture & Honest Platform Boundaries
- **Monitor A Isolation (`MonitorACaptureActivity`)**: Standard Android `MediaProjection` captures a display task/window and cannot isolate an individual HTML `<div>` inside Android Chrome. When capture starts, the companion app transitions immediately into `MonitorACaptureActivity` — a dedicated distraction-free 16:9 YouTube IFrame WebView surface with zero browser address bar or studio chrome — so `MediaProjection` captures ONLY Monitor A cleanly.
- **Permitted Playback Audio (`AudioPlaybackCaptureEngine`)**: Uses Android 10+ (`API 29+`) `AudioPlaybackCaptureConfiguration` targeting `USAGE_MEDIA` and `USAGE_UNKNOWN`. If `RECORD_AUDIO` permission is denied, the device runs Android < 10, or the playing media restricts capture (`ALLOW_CAPTURE_BY_NONE`), it honestly reports `AUDIO_NOT_AVAILABLE` and stops sending silence while the Node.js backend injects a synchronized silent stereo AAC track into FFmpeg. No microphone duplication is introduced.
- **Synchronized A/V Transport (`IngestProtocol` + `CaptureWebSocketClient`)**: Both video (`ScreenVideoEncoder`, H.264 Hardware `MediaCodec`) and audio (`AudioPlaybackCaptureEngine`, AAC-LC `MediaCodec`) share a single monotonic `elapsedRealtimeNanos` clock base and stream via authenticated TLS WebSocket (`wss://<backend>/ws/capture-ingest?sessionId=...&token=...`). Facebook Stream Keys never leave the backend.

## How to Build APK in Android Studio
1. Open Android Studio (Ladybug / Koala or newer with JDK 17+ & Android SDK 35 installed).
2. Select **File > Open** and choose the `/android-capture` folder in this repository.
3. Let Gradle sync using `gradle/wrapper/gradle-wrapper.properties` (Gradle 8.10.2).
4. Connect an Android 10+ phone (USB Debugging enabled) or start an API 34/35 Android Emulator, then click **Run 'app'** or run:
   ```bash
   gradle assembleDebug
   ```
   APK output path: `app/build/outputs/apk/debug/app-debug.apk`.
   For a signed release APK/AAB: **Build > Generate Signed Bundle / APK**.

## How to Pair & Broadcast
1. Open LIVECAST STUDIO in Chrome -> navigate to **Android Capture**.
2. Paste your YouTube Live share URL in Monitor A and tap **Load Preview**.
3. Tap **CONNECT ANDROID** to generate an ephemeral `Session ID` + `Ingest Token` (never contains Facebook credentials).
4. Tap **Launch Companion App** (deep link `livecast://capture?...`) or paste the Backend URL, Session ID, Token, and YouTube URL into the Android Capture app.
5. Tap **START CAPTURE (MONITOR A)** on Android and confirm Android's `MediaProjection` system consent dialog.
6. Verify **VIDEO CAPTURE STATUS** (`CAPTURING`), **AUDIO CAPTURE STATUS** (`AUDIO CAPTURED` or `AUDIO NOT AVAILABLE`), **Monitor B Live Preview**, and tap **START LIVE** to broadcast to Facebook Live via FFmpeg RTMPS.
