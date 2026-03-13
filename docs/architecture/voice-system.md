# Voice System Architecture

## Overview

PyroKitty implements WebRTC spatial voice via a C# sidecar process (`electron-ui/voice/VoiceSidecar.exe`). The sidecar communicates with the Electron main process over JSON-over-stdin/stdout IPC.

```
Electron Main (voice-manager.ts)
  │  stdin: JSON commands (connect, updatePosition, setMicMute, ...)
  │  stdout: JSON events (ready, connected, micLevel, participantJoined, ...)
  │  stderr: log output (prefixed [VoiceSidecar] in Electron log)
  ▼
VoiceSidecar.exe (Program.cs)
  │
  ├── Sdl3Audio — SDL3 mic capture + speaker playback, manual Opus encoding
  ├── VoiceSession — WebRTC peer connection, ICE, DTLS-SRTP, RTP, data channel
  └── JsonIpcContext — holds caps, agent position, HTTP cap posting
```

## Key Files

| File | Purpose |
|------|---------|
| `electron-ui/src/main/voice-manager.ts` | Spawns sidecar, sends commands, relays events to renderer |
| `electron-ui/voice/Program.cs` | Sidecar entry point, JSON IPC command router |
| `electron-ui/voice/VoiceSession.cs` | WebRTC peer connection lifecycle, SDP, ICE, provisioning, data channel |
| `electron-ui/voice/Sdl3Audio.cs` | Audio I/O via SDL3, mic level, file playback, per-SSRC playback |
| `electron-ui/voice/OpusEncoder.cs` | Concentus Opus encoder/decoder wrapper (IAudioEncoder) |
| `electron-ui/voice/VoiceMessages.cs` | Serialization for provision requests (LOCAL / MULTIAGENT) |
| `electron-ui/voice/IVoiceContext.cs` | Context interface (caps, position, HTTP) |
| `electron-ui/voice/JsonIpcContext.cs` | IPC-backed context implementation |

## Dependencies

All via NuGet (defined in `VoiceSidecar.csproj`):
- `SIPSorcery 8.0.23` — WebRTC, RTP, DTLS-SRTP, ICE
- `SIPSorceryMedia.SDL3 0.0.3` — SDL3AudioSource (mic), SDL3AudioEndPoint (speaker)
- `SIPSorceryMedia.SDL3.Native 3.2.28` — native SDL3 binaries
- `Concentus` (transitive via SIPSorcery) — Opus codec

## Connection Flow

1. Electron main calls `voiceManager.connect(caps)` after SL login
2. Sidecar receives `connect` command with SL capability URLs + `parcelLocalId`
3. Session type is always **LOCAL** for spatial voice
4. `VoiceSession.CreatePeerConnection()` — creates RTCPeerConnection with ICE/STUN servers
5. SDP offer generated, processed (Opus fmtp normalized), sent via `ProvisionVoiceAccountRequest` cap
6. Remote SDP answer received, parsed, set on peer connection
7. ICE negotiation → DTLS handshake → peer connection connected
8. Data channel opened (`SLData` created by us, `JanusDataChannel` opened by Janus)
9. Join message `{"j":{"p":true}}` sent on SLData
10. Position updates begin (100ms interval)
11. Audio recording starts, events emitted

## SL WebRTC Protocol Reference

Official doc: `sl-webrtc-dev.pdf` (from `webrtc-public-voice-beta.s3.us-west-2.amazonaws.com`)

### ProvisionVoiceAccountRequest

Spatial voice (LOCAL):
```xml
<llsd><map>
  <key>jsep</key><map>
    <key>type</key><string>offer</string>
    <key>sdp</key><string>...SDP offer...</string>
  </map>
  <key>parcel_local_id</key><integer>2</integer>
  <key>channel_type</key><string>local</string>
  <key>voice_server_type</key><string>webrtc</string>
</map></llsd>
```

P2P/Group/AdHoc (MULTIAGENT):
```xml
<llsd><map>
  <key>jsep</key><map>
    <key>type</key><string>offer</string>
    <key>sdp</key><string>...SDP offer...</string>
  </map>
  <key>channel</key><string>...channel id...</string>
  <key>credentials</key><string>...credentials...</string>
  <key>channel_type</key><string>multiagent</string>
  <key>voice_server_type</key><string>webrtc</string>
</map></llsd>
```

### Data Channel Protocol (Client → Janus)

Messages sent as JSON strings on the `SLData` data channel:

| Key | Type | Description |
|-----|------|-------------|
| `j` | object | Join: `{"p":true}` for primary connection (receives audio levels back) |
| `l` | bool | Leave: always `true` |
| `sp` | object | Speaker position: `{"x":int,"y":int,"z":int}` — world coords in centimeters |
| `sh` | object | Speaker heading: `{"x":int,"y":int,"z":int,"w":int}` — quaternion * 100 |
| `lp` | object | Listener position: same format as `sp` |
| `lh` | object | Listener heading: same format as `sh` |
| `m` | object | Mute peers: `{"uuid": true/false}` |
| `ug` | object | Peer gain: `{"uuid": int}` where int = volume * 200 |

### Data Channel Protocol (Janus → Client)

Each message is an object keyed by agent UUID:

| Key | Type | Description |
|-----|------|-------------|
| `p` | int | Power level (RMS * 128) for VU meters |
| `V` | bool | Voice activity detected |
| `j` | object | Peer joined: `{"p": bool}` |
| `l` | bool | Peer left (always true) |
| `m` | bool | Moderator muted |

## Session Types

### LOCAL (spatial voice)
- Used for ALL spatial voice: region-wide AND parcel-specific
- Provision request: `channel_type: "local"`, `parcel_local_id` at top level (NOT inside jsep)
- `parcel_local_id` comes from `region.parcelMap[y][x]` using agent position (64x64 grid, each cell = 4m)
- Firestorm uses `INVALID_PARCEL_ID` for estate voice, real parcel ID for parcel-specific voice

### MULTIAGENT (P2P/Group/AdHoc)
- Used ONLY for P2P, Group, and AdHoc voice calls — NOT for spatial/parcel voice
- Provision request: `channel_type: "multiagent"`, includes `channel` and `credentials`
- Channel/credentials come from the chat subsystem's call negotiation

### CRITICAL: ParcelVoiceInfoRequest is Vivox-only
`ParcelVoiceInfoRequest` is a Vivox-era capability. Firestorm's `llvoicewebrtc.cpp` NEVER uses it.
Do NOT use it to determine session type for WebRTC voice. Using MULTIAGENT for spatial voice
connects to a different Janus room — mic works (Janus receives audio, RTCP RR confirms) but
recv=0 because no other participants are in that room.

## Audio Pipeline

### Mic → RTP (sending)

```
SDL3AudioSource (mic capture, 48kHz)
  │  OnAudioSourceRawSample callback
  │  NOTE: OnAudioSourceEncodedSample NEVER fires — internal encoding is broken
  ▼
Sdl3Audio.AudioSource_OnAudioSourceRawSample
  │  Track mic level for UI meter
  │  If MicGated (PTT not pressed): stop here
  │  Manual Opus encoding:
  │    1. Feed raw 48kHz PCM directly (do NOT resample — see gotchas)
  │    2. Buffer into 960-sample frames (20ms at 48kHz)
  │    3. Encode with dedicated _micEncoder (OpusAudioEncoder)
  │    4. Fire Sdl3Audio.OnAudioSourceEncodedSample (class-level event)
  ▼
VoiceSession wiring: AudioDevice.OnAudioSourceEncodedSample → pc.SendAudio
  ▼
SIPSorcery RTCPeerConnection.SendAudio → SRTP → UDP → Janus SFU
```

### RTP → Speaker (receiving)

```
Janus SFU → UDP → SRTP → SIPSorcery
  ▼
pc.OnRtpPacketReceived (SDPMediaTypesEnum.audio)
  │  Extract SSRC from RTP header
  ▼
Sdl3Audio.PlayRtpPacket(ssrc, payload)
  │  Opus decode via _audioEncoder → PCM
  │  Per-SSRC mute/gain applied
  ▼
SDL3AudioEndPoint (speaker playback, created lazily on first RTP)
```

### File Playback

```
Sdl3Audio.StartFilePlayback(path, loop)
  │  Stops mic recording first
  │  Creates fresh OpusAudioEncoder (separate from mic/playback encoders)
  │  Reads WAV → PCM → downmix to mono → resample to 48kHz → Opus encode
  ▼
OnAudioSourceEncodedSample → VoiceSession → pc.SendAudio → Janus
```

## PTT (Push-to-Talk)

- `Sdl3Audio.MicGated` property (default: `true` = muted)
- When `MicGated=true`, raw sample handler skips encoding (no audio sent)
- Electron renderer sends `setMicMute` command on PTT press/release
- PTT key: backtick (`` ` ``) in the Electron UI

## Critical Implementation Notes

### Separate Encoder Instances
Each audio path uses its own `OpusAudioEncoder` to avoid Concentus internal state corruption:
- `_audioEncoder` — EndPoint construction and RTP decode (playback)
- `_sourceEncoder` — SDL3AudioSource constructor (unused, but required by API)
- `_micEncoder` — manual mic encoding in raw sample handler
- Fresh instance — file playback (created per-playback in `StartFilePlayback`)

### SDL3 Raw Sample Rate Gotcha
`AudioSource_OnAudioSourceRawSample` reports `AudioSamplingRatesEnum.Rate8KHz` but the actual capture data is **48kHz**. The `Rate8KHz` enum value is misleading. Evidence: 488 samples per callback at ~100 callbacks/sec = 48,800 samples/sec. Do **NOT** resample — feed raw samples directly to the Opus encoder. Resampling 6x produces "tapping on wood" artifacts (10ms of audio stretched to 60ms per frame).

### SDL3AudioSource Internal Encoding is Broken
`SDL3AudioSource.OnAudioSourceEncodedSample` never fires despite `SetAudioSourceFormat(opus)` being called. Only `OnAudioSourceRawSample` works. Mic audio must be manually encoded in the raw sample handler.

### Deferred EndPoint Creation
`SDL3AudioEndPoint` starts its stream callback immediately on construction + `SetAudioSinkFormat()`, causing buffer underrun spam when no audio is playing. EndPoint is created lazily in `EnsureEndpoint()` when the first RTP packet arrives via `PlayRtpPacket()`.

### Single Audio Wiring (Not Dual)
VoiceSession wires only `AudioDevice.OnAudioSourceEncodedSample → pc.SendAudio` (the class-level event). Do NOT also wire `Source.OnAudioSourceEncodedSample` directly — that bypasses the MicGated/PTT check and causes double-sending when PTT is pressed.

### SDP Processing
- `ProcessLocalSdp()` normalizes Opus fmtp parameters in the SDP offer
- `SanitizeRemoteSdp()` drops invalid ICE candidates (port 0) from the answer
- Both are identical to the LibreMetaverse reference implementation

### Provision Request Field Placement
- `parcel_local_id` goes at the **top level** of the LLSD map, NOT inside `jsep`
- Field name is `parcel_local_id` (NOT `parcel_location_id`)
- Both match Firestorm's `llvoicewebrtc.cpp` line 2808 and the official SL WebRTC dev doc

## Estate vs Parcel Voice Channels

Parcels can use either **estate-wide** or **parcel-specific** voice channels. The `UseEstateVoiceChan` flag
(bit 30 of `ParcelFlags`) controls which mode is active:

| Flag State | parcel_local_id | Channel |
|------------|----------------|---------|
| `UseEstateVoiceChan` set | Omit (-1) | Estate-wide — all parcels with this flag share one Janus room |
| `UseEstateVoiceChan` NOT set | Actual parcel local ID | Parcel-specific — isolated Janus room for this parcel only |

**Sending the wrong `parcel_local_id` causes a 401 "Parcel Voice not enabled" error** — the server interprets
it as requesting a parcel-specific channel that doesn't exist on an estate-voice parcel.

### Checking Parcel Flags (node-metaverse)

```typescript
const flags = region.parcels[parcelId]?.ParcelFlags ?? 0;
const allowVoice = !!(flags & (1 << 29));       // AllowVoiceChat
const useEstate  = !!(flags & (1 << 30));        // UseEstateVoiceChan

if (!allowVoice) {
  // Voice disabled on this parcel — don't connect
} else if (useEstate) {
  parcelLocalId = -1;          // estate voice channel
} else {
  parcelLocalId = parcelId;    // parcel-specific voice channel
}
```

### Reference: Firestorm Logic

`firestorm/indra/newview/llvoicewebrtc.cpp` lines 562-586 — `LLVoiceWebRTCConnection::requestVoiceConnection()`:
- If `LLViewerParcelMgr` returns `INVALID_PARCEL_ID` → estate voice (parcel_local_id omitted)
- Otherwise → parcel-specific voice (parcel_local_id = actual local ID)

## Diagnostic Findings

### Confirmed Working
- Mic capture → Opus encode → RTP send (RTCP RR from Janus confirms receipt)
- ICE negotiation, DTLS handshake, peer connection
- Data channel (SLData + JanusDataChannel) — participant join/leave/mute/speaking visible
- Join message `{"j":{"p":true}}` sent and acknowledged
- Position updates sent in correct format (centimeters, quaternion * 100)
- **Full duplex voice**: BB81 plays WAV → Janus → BB82 receives and decodes Opus audio
- **Participant speaking**: Data channel reports power levels (p=60-70 typical) for speaking participants
- **File playback over voice**: WAV → Opus encode → RTP → Janus → other participants hear it

### Resolved: recv=0 (2026-02-16)

**Symptom**: Janus sent zero SRTP audio packets to us (only SRTCP Receiver Reports). Our audio
reached Janus and was forwarded to others, but we received nothing back.

**Root causes** (fixed in sequence):
1. **Wrong session type**: Originally used MULTIAGENT for spatial voice — connects to a different
   (empty) Janus room. Fixed: always use LOCAL with `channel_type: "local"`.
2. **Wrong field placement**: `parcel_local_id` was inside `jsep` instead of at the LLSD top level.
   Fixed: moved to top level.
3. **Estate vs parcel voice mismatch**: Sent actual `parcel_local_id` (e.g., 5) when the parcel
   uses estate voice (`UseEstateVoiceChan` flag set). Server returned 401 "Parcel Voice not enabled".
   Fixed: check `ParcelFlags` bit 30 — if set, use -1 (estate); if not, use actual parcel ID.
4. **Global coordinates**: Position updates used local region coordinates (0-256) instead of global
   grid coordinates. Fixed: `globalX = region.xCoordinate * 256 + localPos.x`.

**Verification**: BB81 (file playback) → BB82 (listener) on Helios region. BB82 received 1871+ RTP
packets in 39 seconds. Data channel confirmed BB81 speaking with power=60-70.

### Test Script

`electron-ui/scripts/test-voice.ts` — standalone voice test without running the full Electron app:

```bash
# Terminal 1: play WAV file over voice
cd electron-ui && npx tsx scripts/test-voice.ts --play

# Terminal 2: listen for incoming voice
cd electron-ui && npx tsx scripts/test-voice.ts --listen --account 3
```

Accounts stored in `electron-ui/data/accounts.json`. Default is account 1 (BB81).

### Known Cosmetic Issues
- SDL3AudioEndPoint buffer underrun spam: endpoint callback runs continuously but audio arrives in bursts.
  Caused by deferred endpoint creation — once audio starts flowing, the underruns are intermittent.

## Building

```bash
cd electron-ui/voice && dotnet build
```

Target: `net8.0`. Output: `electron-ui/voice/bin/Debug/net8.0/VoiceSidecar.exe`

## Logs

Voice sidecar logs go to stderr, captured by Electron main process and written to:
`C:\Users\callcolor\AppData\Roaming\pyrokitty-ui\pyrokitty.log`

Lines are prefixed with `[VoiceSidecar]`. Key log patterns:
- `Using local voice (parcelLocalId=N)` — session type and parcel ID
- `Local voice provisioned` — successful provision
- `ICE connection state: connected` — ICE established
- `Peer connection state: connected` — DTLS-SRTP ready, audio can flow
- `Mic encode #N: len=X` — manual mic Opus encoding working
- `RTP stats (t+Ns): sent=X, recv=Y` — periodic packet counters
- `Sending audio packet #N` — confirms audio reaching pc.SendAudio
- `RTP-range #N: ...B, PT=X` — incoming RTP/RTCP packets at raw UDP level
- `RTCP RR #N` / `RTCP SR #N` — RTCP reports (RR = receiver, SR = sender)
- `Parcel local ID: N` — from voice-manager.ts at connect time

## Reference

- Official SL WebRTC dev doc: `sl-webrtc-dev.pdf`
- LibreMetaverse reference: `C:\DeeDrive\dev\libremetaverse\LibreMetaverse.Voice.WebRTC\`
- Firestorm WebRTC voice: `firestorm/indra/newview/llvoicewebrtc.cpp`
- Test program: `libremetaverse\Programs\WebRtcTest\WebRtcTest.cs`
- Voice test script: `electron-ui/scripts/test-voice.ts`
- Test accounts: `electron-ui/data/accounts.json`

## WebRTC-Enabled Regions

Not all SL regions support WebRTC voice. Vivox-only regions return 503 "WebRTC local voice channels
not supported on Vivox-configured simulator" when you POST to `ProvisionVoiceAccountRequest`.

Known WebRTC regions:
- **Helios** (`uri:Helios&130&126&21`) — used for testing
