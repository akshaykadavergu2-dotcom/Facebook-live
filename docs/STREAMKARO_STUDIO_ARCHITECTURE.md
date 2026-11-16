# StreamKaro Studio — Architecture

## Product direction
StreamKaro Studio is a native mobile broadcast production system. Android is implemented first; iOS follows with SwiftUI, AVFoundation, Metal and VideoToolbox. The UI, project schema and engine contracts are platform-independent.

## Existing functionality to preserve
The current Android application remains in `com.livecast.capture` for compatibility. Its splash flow, MainActivity, screen capture foreground service, telemetry WebSocket, overlay editor, audio mixer, MP4 recording and backend integration are retained. The new Compose studio shell routes into the existing broadcast studio.

## Android modules (incremental migration within :app)
- `studio/model`: versioned project, scene and source schema.
- `studio/engine`: UI-facing engine contract and state.
- `studio/rendering`: OpenGL ES surface and future texture compositor.
- `studio/storage`: local project persistence; never store stream credentials here.
- `studio/ui`: Compose production shell.
- Existing `com.livecast.capture`: legacy capture, mixer, recording, overlay and backend adapters.

## Media pipeline target
Sources -> source transforms/filters -> OpenGL ES scene compositor -> Program frame -> hardware encoder -> output fan-out and/or local recorder. Audio capture/mix/filter -> timestamp synchronization -> AAC encoder. Preview, recording and all streaming destinations must consume the same Program composition.

## iOS counterpart
SwiftUI presentation; AVFoundation capture; Metal compositor; VideoToolbox encoding; AVAudioEngine audio; the same versioned JSON project schema and equivalent engine contract.

## Security
Stream keys and OAuth tokens must use Android Keystore-backed encrypted storage / iOS Keychain. Never include credentials in project JSON, telemetry, logs, crash reports or exported project bundles.

## Build
Run from `android-capture/`:
```bash
gradle testDebugUnitTest assembleDebug --no-daemon
```

## Milestone scope
This foundation adds the Compose shell, project model and persistence, engine contract, and an OpenGL ES context surface. It does not yet claim that scene compositing, camera texture ingestion, multi-output encoding or SRT are complete; those are subsequent implementation milestones.
