# LIVECAST STUDIO — Android Native Live Capture Companion App (`/android-capture`)

Package name: `com.livecast.capture` · Min SDK: Android 8.0 (`API 26`) · Target/Compile SDK: Android 15 (`API 35`) · Audio Playback Capture: Android 10+ (`API 29+`)

---

## Architecture & Honest Platform Boundaries
- **Monitor A Isolation (`MonitorACaptureActivity`)**: Standard Android `MediaProjection` captures a display task/window and cannot isolate an individual HTML `<div>` inside Android Chrome. When capture starts, the companion app launches `MonitorACaptureActivity` — a dedicated 16:9 YouTube IFrame WebView surface with zero browser address bar or studio chrome — so `MediaProjection` captures **Monitor A only**.
- **Permitted Playback Audio (`AudioPlaybackCaptureEngine`)**: Uses Android 10+ (`API 29+`) `AudioPlaybackCaptureConfiguration` targeting `USAGE_MEDIA` and `USAGE_UNKNOWN`. If `RECORD_AUDIO` permission is denied, the device runs Android < 10, or the playing media disables capture (`ALLOW_CAPTURE_BY_NONE` / DRM), the app honestly reports `AUDIO_NOT_AVAILABLE` and never injects microphone audio or attempts DRM bypass. The backend injects a synchronized silent stereo AAC track (`anullsrc`) when audio capture is unavailable.
- **Synchronized A/V Transport (`IngestProtocol` + `CaptureWebSocketClient`)**: Video (`ScreenVideoEncoder`, hardware H.264 `MediaCodec`) and audio (`AudioPlaybackCaptureEngine`, AAC-LC `MediaCodec`) calibrate onto a single monotonic `System.nanoTime() / 1000L` clock base and stream binary `LC` frames over TLS WebSocket (`wss://facebook-live-gvx5.onrender.com/ws/capture-ingest?sessionId=...&token=...`). Facebook Stream Keys remain encrypted (`AES-256-GCM`) exclusively on the Render backend.
- **Foreground Capture Service (`CaptureForegroundService`)**: Runs with `dataSync` during pre-consent pairing and upgrades cleanly to `mediaProjection` after Android's `MediaProjection` consent dialog is confirmed, displaying a persistent ongoing notification with a one-tap **Stop Capture** action.

---

## Step-by-Step APK Build Instructions

### Option 1 — Build Using Android Studio (Recommended)
1. Install **Android Studio** (Ladybug / Koala or newer) with **JDK 17** and **Android SDK 35** (`platforms;android-35` and `build-tools;35.0.0`).
2. Select **File > Open** and choose the `/android-capture` folder inside this repository (`akshaykadavergu2-dotcom/Facebook-live/android-capture`).
3. Wait for Android Studio to sync Gradle `8.10.2` (defined in `gradle/wrapper/gradle-wrapper.properties`).
4. Build an installable **Debug APK**:
   - Menu: **Build > Build Bundle(s) / APK(s) > Build APK(s)**
   - Output file:
     `android-capture/app/build/outputs/apk/debug/app-debug.apk`
5. (Optional) Build a **Signed Release APK** for distribution:
   - Menu: **Build > Generate Signed App Bundle / APK...** -> select **APK** -> create or choose your keystore `.jks` -> choose **release** build variant -> finish.
   - Output file: `android-capture/app/build/outputs/apk/release/app-release.apk`.

### Option 2 — Build From Command Line (JDK 17 + Gradle 8.10.2 + Android SDK 35)
From the repository root (or inside `android-capture/`):
```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
gradle -p android-capture testDebugUnitTest assembleDebug --no-daemon
```
Output APK:
`android-capture/app/build/outputs/apk/debug/app-debug.apk`

### Option 3 — Automatic Cloud Build via GitHub Actions
This repository includes `.github/workflows/android-apk.yml`.
1. Push your changes to `akshaykadavergu2-dotcom/Facebook-live` on GitHub.
2. Open the **Actions** tab -> select **Build Android Companion APK** (runs automatically on pushes touching `android-capture/**`, or click **Run workflow**).
3. When the job completes, download the **`livecast-android-capture-debug-apk`** artifact and unzip it to obtain `app-debug.apk`.

---

## Step-by-Step Phone Installation Instructions

### Method A — Install Directly on Your Android Phone (No PC Required after Downloading APK)
1. Transfer or download `app-debug.apk` onto your Android 10+ phone (via GitHub Actions download, Google Drive, or USB copy).
2. Tap `app-debug.apk` in your phone's **Files** app.
3. If prompted, allow **Install unknown apps** for Chrome / Files in Android Settings.
4. Tap **Install**, then **Open** (or leave installed so deep links from Chrome launch it automatically).

### Method B — Install via USB with ADB (From PC/Mac)
1. On your Android phone, open **Settings > About phone** and tap **Build number** 7 times to enable Developer Options, then enable **USB debugging**.
2. Connect the phone via USB and confirm the RSA debugging prompt on the phone screen.
3. Run:
   ```bash
   adb install -r android-capture/app/build/outputs/apk/debug/app-debug.apk
   ```

---

## Pairing & Live Capture Workflow
1. Open `https://streamkarolive.netlify.app` in **Android Chrome**.
2. Go to the **Android Capture** tab (or **Monitor A** YouTube Preview), paste a valid YouTube Live / video link, and tap **Load Preview**.
3. Tap **CONNECT ANDROID** to create a paired capture session (`Session ID` + ephemeral `Ingest Token` scoped to `https://facebook-live-gvx5.onrender.com`).
4. Tap **Launch Companion App** — Chrome opens `livecast://capture?backend=...&sessionId=...&token=...&yt=...` directly in **Livecast Capture**, pre-filling all fields and connecting over TLS `wss://`.
5. Tap **START CAPTURE (MONITOR A)**:
   - Grant `RECORD_AUDIO` (used strictly for `AudioPlaybackCapture`, not microphone) and `POST_NOTIFICATIONS` if prompted.
   - Approve Android's system **Start recording or casting with Livecast Capture?** `MediaProjection` dialog.
6. Confirm live status in both the Android app and web **Monitor B**:
   - **Connection**: `CAPTURING`
   - **Video Status**: `CAPTURING` (live FPS + `1280x720`)
   - **Audio Status**: `AUDIO_CAPTURED` (or `AUDIO_NOT_AVAILABLE` if source blocks playback capture)
7. In the web dashboard, enter your Facebook RTMP server URL + Stream Key (stored server-side with `AES-256-GCM`) and tap **START LIVE** to broadcast to Facebook Live via FFmpeg RTMPS.
8. Tap **Stop Capture** in the Android app, notification drawer, phone back button, or web dashboard to release `MediaProjection`, codecs, and sockets immediately.
