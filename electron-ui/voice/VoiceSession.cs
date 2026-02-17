/*
 * Adapted from LibreMetaverse.Voice.WebRTC/VoiceSession.cs
 * Copyright (c) 2025, Sjofn LLC - BSD License
 *
 * Modified for standalone sidecar: GridClient replaced with IVoiceContext.
 */

using LitJson;
using OpenMetaverse;
using OpenMetaverse.StructuredData;
using SIPSorcery.Net;
using SIPSorcery.SIP.App;
using SIPSorcery.Sys;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace VoiceSidecar
{
    public class VoiceSession : IDisposable
    {
        public const string PROVISION_VOICE_ACCOUNT_CAP = "ProvisionVoiceAccountRequest";
        public const string VOICE_SIGNALING_CAP = "VoiceSignalingRequest";

        public enum ESessionType
        {
            LOCAL,
            MUTLIAGENT
        }

        private readonly IVoiceContext Context;
        private readonly Sdl3Audio AudioDevice;
        private readonly IVoiceLogger _log;
        private RTCPeerConnection PeerConnection;

        public event Action OnPeerConnectionClosed;
        public event Action OnPeerConnectionReady;
        public event Action OnDataChannelReady;
        public event Action OnReprovisionSucceeded;
        public event Action<Exception> OnReprovisionFailed;
        public event Action<UUID> OnPeerJoined;
        public event Action<UUID> OnPeerLeft;
        public event Action<UUID, OSDMap> OnPeerPositionUpdated;
        public event Action<List<UUID>> OnPeerListUpdated;

        public class PeerAudioState
        {
            public int? Power { get; set; }
            public bool? VoiceActive { get; set; }
            public bool? JoinedPrimary { get; set; }
            public bool Left { get; set; }
        }
        public event Action<UUID, PeerAudioState> OnPeerAudioUpdated;
        private bool answerReceived = false;

        public struct Int3 { public int X; public int Y; public int Z; }
        public struct Int4 { public int X; public int Y; public int Z; public int W; }
        public class AvatarPosition
        {
            public UUID AgentId { get; set; }
            public Int3? SenderPosition { get; set; }
            public Int4? SenderHeading { get; set; }
            public Int3? ListenerPosition { get; set; }
            public Int4? ListenerHeading { get; set; }
        }
        public event Action<Dictionary<UUID, bool>> OnMuteMapReceived;
        public event Action<Dictionary<UUID, int>> OnGainMapReceived;

        public UUID SessionId { get; private set; }
        public string SdpLocal => PeerConnection?.localDescription.sdp.ToString();
        public string SdpRemote => PeerConnection?.remoteDescription.sdp.ToString();
        public bool Connected => PeerConnection?.connectionState == RTCPeerConnectionState.connected;
        public RTCDataChannel DataChannel => PeerConnection?.DataChannels?.FirstOrDefault();
        private ESessionType SessionType { get; }
        private readonly ConcurrentQueue<RTCIceCandidate> PendingCandidates = new();
        private int pendingCandidateCount = 0;
        private readonly object _candidateLock = new();
        private readonly CancellationTokenSource Cts = new();

        private CancellationTokenSource iceTrickleCts;
        private Task iceTrickleTask;
        private readonly SemaphoreSlim reprovisionLock = new(1, 1);
        private volatile bool reprovisionScheduled = false;

        public string ChannelId { get; set; }
        public string ChannelCredentials { get; set; }

        private readonly PeerManager peerManager;
        private readonly DataChannelProcessor dataChannelProcessor;

        public List<UUID> GetKnownPeers()
        {
            try { return peerManager.GetKnownPeers(); }
            catch { return new List<UUID>(); }
        }

        private CancellationTokenSource positionLoopCts;
        private Task positionLoopTask;
        private CancellationTokenSource keepAliveLoopCts;
        private Task keepAliveLoopTask;

        private volatile bool mSpatialCoordsDirty = true;
        private Vector3 lastObservedPos = Vector3.Zero;
        private Quaternion lastObservedHeading = Quaternion.Identity;
        private Vector3 lastSentPos = Vector3.Zero;
        private Quaternion lastSentHeading = Quaternion.Identity;
        private const double POSITION_CHANGE_THRESHOLD_METERS = 0.01;
        private const double HEADING_CHANGE_THRESHOLD = 0.0005;

        internal VoiceSession(Sdl3Audio audioDevice, ESessionType type, IVoiceContext context, IVoiceLogger logger = null)
        {
            Context = context;
            AudioDevice = audioDevice;
            SessionType = type;
            SessionId = UUID.Zero;
            _log = logger ?? new ConsoleVoiceLogger();

            peerManager = new PeerManager(AudioDevice, _log);
            peerManager.PeerJoined += id => { try { OnPeerJoined?.Invoke(id); } catch { } };
            peerManager.PeerLeft += id => { try { OnPeerLeft?.Invoke(id); } catch { } };
            peerManager.PeerPositionUpdated += (id, map) => { try { OnPeerPositionUpdated?.Invoke(id, map); } catch { } };
            peerManager.PeerListUpdated += list => { try { OnPeerListUpdated?.Invoke(list); } catch { } };
            peerManager.PeerAudioUpdated += (id, state) => { try { OnPeerAudioUpdated?.Invoke(id, state); } catch { } };
            peerManager.MuteMapReceived += m => { try { OnMuteMapReceived?.Invoke(m); } catch { } };
            peerManager.GainMapReceived += g => { try { OnGainMapReceived?.Invoke(g); } catch { } };

            dataChannelProcessor = new DataChannelProcessor(peerManager, _log, TrySendDataChannelString);
        }

        public async Task StartAsync(CancellationToken ct = default)
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(Cts.Token, ct);
            var token = linked.Token;
            PeerConnection = await CreatePeerConnection(token).ConfigureAwait(false);
            iceTrickleTask = IceTrickleStart(token);
        }

        private async Task<OSD> PostCapsWithRetries(Uri cap, OSD payload, int maxAttempts = 10, TimeSpan? timeout = null, CancellationToken ct = default)
        {
            if (cap == null) throw new VoiceException("Capability URI is null.");
            if (timeout == null) timeout = TimeSpan.FromSeconds(10);

            int attempt = 0;
            Exception lastEx = null;
            while (attempt < maxAttempts)
            {
                attempt++;
                try
                {
                    var token = ct == CancellationToken.None ? Cts.Token : ct;
                    var bodyBytes = Encoding.UTF8.GetBytes(OSDParser.SerializeLLSDXmlString(payload));

                    using var cts = CancellationTokenSource.CreateLinkedTokenSource(token);
                    cts.CancelAfter(timeout.Value);

                    var data = await Context.PostCapAsync(cap, bodyBytes, cts.Token).ConfigureAwait(false);
                    var osd = OSDParser.Deserialize(data);
                    return osd;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested || Cts.Token.IsCancellationRequested)
                {
                    break;
                }
                catch (VoiceException) { throw; }
                catch (Exception ex)
                {
                    lastEx = ex;
                }

                var backoffMs = Math.Min(200 * attempt, 2000);
                try { await Task.Delay(backoffMs, ct == CancellationToken.None ? Cts.Token : ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { break; }
            }

            throw new VoiceException($"Failed to POST to capability {cap}: {lastEx?.Message}");
        }

        public async Task<RTCPeerConnection> CreatePeerConnection(CancellationToken ct = default)
        {
            var iceServers = new List<RTCIceServer>
            {
                new() { urls = "stun:stun1.agni.secondlife.io:3478" },
                new() { urls = "stun:stun2.agni.secondlife.io:3478" },
                new() { urls = "stun:stun3.agni.secondlife.io:3478" },
                new() { urls = "stun:stun.l.google.com:19302" },
                new() { urls = "stun:stun2.l.google.com:19302" },
            };

            try
            {
                var turnUrl = Environment.GetEnvironmentVariable("LIBREMETAVERSE_TURN_URL");
                var turnUser = Environment.GetEnvironmentVariable("LIBREMETAVERSE_TURN_USER");
                var turnPass = Environment.GetEnvironmentVariable("LIBREMETAVERSE_TURN_PASS");
                if (!string.IsNullOrWhiteSpace(turnUrl))
                {
                    var turnServer = new RTCIceServer { urls = turnUrl };
                    if (!string.IsNullOrEmpty(turnUser)) turnServer.username = turnUser;
                    if (!string.IsNullOrEmpty(turnPass)) turnServer.credential = turnPass;
                    iceServers.Add(turnServer);
                    _log.Debug($"Added TURN server from environment: {turnUrl}");
                }
            }
            catch (Exception ex) { _log.Warn($"Failed to read TURN environment variables: {ex.Message}"); }

            var pc = new RTCPeerConnection(new RTCConfiguration
            {
                X_ICEIncludeAllInterfaceAddresses = false,
                iceServers = iceServers
            }, 0, new PortRange(49152, 65535));

            PeerConnection = pc;

            pc.OnRtpPacketReceived += (IPEndPoint remoteEndPoint, SDPMediaTypesEnum mediaType, RTPPacket rtpPacket) =>
            {
                if (mediaType == SDPMediaTypesEnum.audio && AudioDevice != null)
                {
                    try
                    {
                        AudioDevice.PlayRtpPacket(rtpPacket.Header.SyncSource, rtpPacket.Payload);
                    }
                    catch (Exception ex) { _log.Warn($"Failed to play RTP packet: {ex.Message}"); }
                }
            };

            pc.oniceconnectionstatechange += (state) =>
            {
                _log.Debug($"ICE connection state: {state}");
                if (state == RTCIceConnectionState.failed)
                {
                    _log.Warn("ICE connection failed - possible NAT/firewall issue");
                    try { ScheduleReprovisionWithBackoff(); } catch { }
                }
            };

            var dc = await pc.createDataChannel("SLData", new RTCDataChannelInit { ordered = true }).ConfigureAwait(false);

            dc.onopen += () =>
            {
                _log.Debug("Data channel opened");
                var joinSent = TrySendDataChannelString("{\"j\":{\"p\":true}}");
                _log.Debug($"Join message sent: {joinSent}");
                Task.Delay(100, ct).ContinueWith(_ => StartPositionLoop(), TaskScheduler.Default);
                StartKeepAliveLoop();
                OnDataChannelReady?.Invoke();
            };

            dc.onclose += () =>
            {
                StopPositionLoop();
                StopKeepAliveLoop();
                OnDataChannelReady?.Invoke();
            };

            dc.onmessage += (channel, type, data) =>
            {
                var msg = data != null ? Encoding.UTF8.GetString(data) : string.Empty;
                Task.Run(() => HandleDataChannelMessage(msg), ct);
            };

            if (AudioDevice == null)
            {
                _log.Error("AudioDevice is null");
                throw new VoiceException("Internal error: AudioDevice is null.");
            }
            if (AudioDevice.Source == null)
            {
                _log.Warn("Recording is null. Attempting to create default recording source.");
                try { AudioDevice.SetRecordingDevice(null); } catch (Exception ex) { _log.Warn($"Failed to create default recording source: {ex.Message}"); }
                if (AudioDevice.Source == null)
                {
                    _log.Error("No audio recording source available after attempts to create one.");
                    throw new VoiceException("No audio recording source available.");
                }
            }

            var formats = AudioDevice?.Source?.GetAudioSourceFormats();
            var audioTrack = new MediaStreamTrack(formats);
            pc.addTrack(audioTrack);
            var offer = pc.createOffer();
            var rawSdp = offer.sdp.ToString();
            var processedSdp = ProcessLocalSdp(rawSdp);
            offer.sdp = processedSdp;
            await pc.setLocalDescription(offer).ConfigureAwait(false);

            pc.localDescription.sdp.SessionName = "LibreMetaVoice";

            pc.onicecandidate += (candidate) =>
            {
                if (candidate == null) return;
                EnqueueCandidate(candidate);
            };

            pc.onicegatheringstatechange += async (state) =>
            {
                try
                {
                    if (state == RTCIceGatheringState.complete)
                    {
                        _log.Debug("ICE gathering complete");
                        await IceTrickleStop().ConfigureAwait(false);
                    }
                    else if (state == RTCIceGatheringState.gathering)
                    {
                        _ = IceTrickleStart(ct);
                    }
                }
                catch (Exception ex) { _log.Warn($"onicegatheringstatechange exception: {ex.Message}"); }
            };

            pc.ondatachannel += (channel) =>
            {
                channel.onmessage += (ch, chType, chData) =>
                {
                    var msg = chData != null ? Encoding.UTF8.GetString(chData) : string.Empty;
                    Task.Run(() => HandleDataChannelMessage(msg), ct);
                };
            };

            pc.onconnectionstatechange += async (state) =>
            {
                _log.Debug($"Peer connection state: {state}");
                if (state == RTCPeerConnectionState.connected)
                {
                    // Playback starts on-demand in PlayRtpPacket when first RTP arrives.
                    // Starting it eagerly causes buffer underrun spam when nobody else is talking.
                    try
                    {
                        if (AudioDevice?.Source != null)
                        {
                            AudioDevice.StartRecording();
                            _log.Debug("Recording started on connection");
                        }
                    }
                    catch (Exception ex) { _log.Warn($"Failed to start recording: {ex.Message}"); }

                    try
                    {
                        var audioStream = pc.AudioStream;
                        _log.Debug($"AudioStream: localTrack={audioStream?.LocalTrack != null}, remoteTrack={audioStream?.RemoteTrack != null}, localStatus={audioStream?.LocalTrack?.StreamStatus}");
                    }
                    catch { }

                    OnPeerConnectionReady?.Invoke();
                }
                else if (state == RTCPeerConnectionState.failed || state == RTCPeerConnectionState.disconnected || state == RTCPeerConnectionState.closed)
                {
                    if (AudioDevice != null)
                    {
                        try { await AudioDevice.StopPlaybackAsync().ConfigureAwait(false); } catch { }
                        try { AudioDevice.StopRecording(); } catch { }
                    }
                    if (state == RTCPeerConnectionState.closed)
                    {
                        OnPeerConnectionClosed?.Invoke();
                    }
                }
            };

            // Wire audio to WebRTC through Sdl3Audio's class-level event only.
            // Mic path: Source raw samples → manual Opus encode (MicGated/PTT check)
            //   → Sdl3Audio.OnAudioSourceEncodedSample (class event) → pc.SendAudio
            // File path: WAV → Opus encode → Sdl3Audio.OnAudioSourceEncodedSample → pc.SendAudio
            if (AudioDevice != null)
            {
                try { AudioDevice.OnAudioSourceEncodedSample -= pc.SendAudio; } catch { }
                AudioDevice.OnAudioSourceEncodedSample += pc.SendAudio;
            }

            return pc;
        }

        private void StartPositionLoop()
        {
            if (positionLoopTask != null && !positionLoopTask.IsCompleted) return;
            positionLoopCts = CancellationTokenSource.CreateLinkedTokenSource(Cts.Token);
            var token = positionLoopCts.Token;
            positionLoopTask = Task.Run(async () =>
            {
                while (!token.IsCancellationRequested)
                {
                    try
                    {
                        var dc = DataChannel;
                        if (dc == null || dc.readyState != RTCDataChannelState.open)
                        {
                            await Task.Delay(100, token).ConfigureAwait(false);
                            continue;
                        }

                        var pos = Context.AgentPosition;
                        var heading = Context.AgentRotation;

                        if (pos == Vector3.Zero)
                        {
                            await Task.Delay(100, token).ConfigureAwait(false);
                            continue;
                        }

                        bool posChanged = (Math.Abs(pos.X - lastObservedPos.X) > POSITION_CHANGE_THRESHOLD_METERS)
                                          || (Math.Abs(pos.Y - lastObservedPos.Y) > POSITION_CHANGE_THRESHOLD_METERS)
                                          || (Math.Abs(pos.Z - lastObservedPos.Z) > POSITION_CHANGE_THRESHOLD_METERS);

                        bool headingChanged = (Math.Abs(heading.X - lastObservedHeading.X) > HEADING_CHANGE_THRESHOLD)
                                              || (Math.Abs(heading.Y - lastObservedHeading.Y) > HEADING_CHANGE_THRESHOLD)
                                              || (Math.Abs(heading.Z - lastObservedHeading.Z) > HEADING_CHANGE_THRESHOLD)
                                              || (Math.Abs(heading.W - lastObservedHeading.W) > HEADING_CHANGE_THRESHOLD);

                        if (posChanged || headingChanged)
                        {
                            mSpatialCoordsDirty = true;
                            lastObservedPos = pos;
                            lastObservedHeading = heading;
                        }

                        SendPositionUpdate(dc, pos, heading);
                    }
                    catch (OperationCanceledException) { break; }
                    catch (Exception ex) { _log.Error($"Position loop error: {ex.Message}"); }
                    try { await Task.Delay(100, token).ConfigureAwait(false); } catch (OperationCanceledException) { break; }
                }
            }, token);
        }

        private void StopPositionLoop()
        {
            try { positionLoopCts?.Cancel(); positionLoopTask?.Wait(500); } catch { }
            finally { positionLoopCts?.Dispose(); positionLoopCts = null; positionLoopTask = null; }
        }

        private void StartKeepAliveLoop()
        {
            if (keepAliveLoopTask != null && !keepAliveLoopTask.IsCompleted) return;
            keepAliveLoopCts = CancellationTokenSource.CreateLinkedTokenSource(Cts.Token);
            var token = keepAliveLoopCts.Token;
            keepAliveLoopTask = Task.Run(async () =>
            {
                while (!token.IsCancellationRequested)
                {
                    try
                    {
                        var dc = DataChannel;
                        if (dc != null && dc.readyState == RTCDataChannelState.open)
                            TrySendDataChannelString("{\"ping\":true}");
                    }
                    catch (OperationCanceledException) { break; }
                    catch (Exception ex) { _log.Error($"Keepalive loop error: {ex.Message}"); }
                    try { await Task.Delay(5000, token).ConfigureAwait(false); } catch (OperationCanceledException) { break; }
                }
            }, token);
        }

        private void StopKeepAliveLoop()
        {
            try { keepAliveLoopCts?.Cancel(); keepAliveLoopTask?.Wait(500); } catch { }
            finally { keepAliveLoopCts?.Dispose(); keepAliveLoopCts = null; keepAliveLoopTask = null; }
        }

        private void EnqueueCandidate(RTCIceCandidate candidate)
        {
            if (candidate == null) return;
            lock (_candidateLock) { PendingCandidates.Enqueue(candidate); Interlocked.Increment(ref pendingCandidateCount); }
        }

        private List<RTCIceCandidate> DequeueAllCandidates()
        {
            var list = new List<RTCIceCandidate>();
            lock (_candidateLock)
            {
                while (PendingCandidates.TryDequeue(out var c)) { list.Add(c); Interlocked.Decrement(ref pendingCandidateCount); }
            }
            return list;
        }

        private int GetPendingCandidateCount() => Interlocked.CompareExchange(ref pendingCandidateCount, 0, 0);

        private async Task SendVoiceSignalingRequest()
        {
            if (!answerReceived) return;

            var cap = Context.GetCapability(VOICE_SIGNALING_CAP);
            if (cap == null) return;

            var dequeued = DequeueAllCandidates();
            if (dequeued.Count == 0) return;

            var canArray = new OSDArray();
            foreach (var candidate in dequeued)
            {
                var map = new OSDMap
                {
                    { "sdpMid", candidate.sdpMid },
                    { "sdpMLineIndex", candidate.sdpMLineIndex },
                    { "candidate", candidate.candidate }
                };
                canArray.Add(map);
            }

            var payload = new OSDMap
            {
                { "voice_server_type", "webrtc" },
                { "viewer_session", SessionId },
                { "candidates", canArray }
            };

            try
            {
                await PostCapsWithRetries(cap, payload).ConfigureAwait(false);
                _log.Debug($"Sent {canArray.Count} ICE candidates");
            }
            catch (Exception ex) { _log.Warn($"Failed to send ICE candidates: {ex.Message}"); }
        }

        private async Task SendVoiceSignalingCompleteRequest()
        {
            var cap = Context.GetCapability(VOICE_SIGNALING_CAP);
            if (cap == null) return;

            var canArray = new OSDArray();
            canArray.Add(new OSDMap { { "completed", true } });

            var payload = new OSDMap
            {
                { "voice_server_type", "webrtc" },
                { "viewer_session", SessionId },
                { "candidates", canArray }
            };

            try { await PostCapsWithRetries(cap, payload).ConfigureAwait(false); }
            catch (Exception ex) { _log.Warn($"Sending ICE Signaling Complete failed: {ex.Message}"); }
        }

        private void HandleDataChannelMessage(string msg)
        {
            dataChannelProcessor?.ProcessMessage(msg, SessionId);
        }

        public bool TrySendDataChannelString(string str)
        {
            try
            {
                var dc = DataChannel;
                if (dc == null) return false;
                dc.send(str);
                return true;
            }
            catch (Exception ex) { _log.Debug($"Failed to send data channel message: {ex.Message}"); return false; }
        }

        public bool SetPeerMute(UUID peerId, bool mute) => dataChannelProcessor.SetPeerMute(peerId, mute);
        public bool SetPeerGain(UUID peerId, int gain) => dataChannelProcessor.SetPeerGain(peerId, gain);
        public bool SendJoin(bool primary = true) => dataChannelProcessor.SendJoin(primary);
        public bool SendLeave() => dataChannelProcessor.SendLeave();

        public bool SendPosition(Vector3 globalPos, Quaternion heading)
        {
            var ok = dataChannelProcessor.SendPosition(globalPos, heading);
            if (ok) { lastSentPos = globalPos; lastSentHeading = heading; mSpatialCoordsDirty = false; }
            return ok;
        }

        private Task IceTrickleStart(CancellationToken external = default)
        {
            if (iceTrickleTask != null
                && (iceTrickleTask.Status == TaskStatus.Running
                || iceTrickleTask.Status == TaskStatus.WaitingToRun
                || iceTrickleTask.Status == TaskStatus.WaitingForActivation))
            {
                return iceTrickleTask;
            }

            iceTrickleCts = external == CancellationToken.None
                ? CancellationTokenSource.CreateLinkedTokenSource(Cts.Token)
                : CancellationTokenSource.CreateLinkedTokenSource(Cts.Token, external);

            var token = iceTrickleCts.Token;
            async Task Loop()
            {
                try
                {
                    while (!token.IsCancellationRequested)
                    {
                        try
                        {
                            if (Context.Connected && !SessionId.Equals(UUID.Zero) && GetPendingCandidateCount() > 0)
                            {
                                await SendVoiceSignalingRequest().ConfigureAwait(false);
                            }
                        }
                        catch (OperationCanceledException) { break; }
                        catch (Exception ex) { _log.Warn($"IceTrickle poll exception: {ex.Message}"); }
                        try { await Task.Delay(25, token).ConfigureAwait(false); } catch (OperationCanceledException) { break; }
                    }
                }
                catch (Exception ex) { _log.Warn($"IceTrickle loop terminated: {ex.Message}"); }
            }

            iceTrickleTask = Task.Run(Loop, token);
            return iceTrickleTask;
        }

        private async Task IceTrickleStop()
        {
            while (GetPendingCandidateCount() > 0)
            {
                await Task.Delay(1000);
            }
            if (PeerConnection != null && PeerConnection.iceGatheringState == RTCIceGatheringState.complete)
            {
                iceTrickleCts?.Cancel();
                await SendVoiceSignalingCompleteRequest().ConfigureAwait(false);
            }
        }

        private void ScheduleReprovisionWithBackoff()
        {
            if (reprovisionScheduled) return;
            reprovisionScheduled = true;

            _ = Task.Run(async () =>
            {
                try
                {
                    int attempt = 0;
                    const int maxAttempts = 6;
                    int delayMs = 1000;

                    while (!Cts.Token.IsCancellationRequested && attempt < maxAttempts)
                    {
                        attempt++;
                        _log.Debug($"Reprovision attempt {attempt}/{maxAttempts} in {delayMs}ms");
                        try { await Task.Delay(delayMs, Cts.Token).ConfigureAwait(false); } catch (OperationCanceledException) { break; }

                        try
                        {
                            await AttemptReprovisionAsync().ConfigureAwait(false);
                            _log.Debug($"Reprovision attempt {attempt} succeeded");
                            reprovisionScheduled = false;
                            return;
                        }
                        catch (OperationCanceledException) { break; }
                        catch (Exception ex) { _log.Warn($"Reprovision attempt {attempt} failed: {ex.Message}"); }

                        delayMs = Math.Min(delayMs * 2, 60000);
                    }
                    _log.Warn($"Reprovision exhausted after {attempt} attempts");
                }
                finally { reprovisionScheduled = false; }
            }, Cts.Token);
        }

        private string ProcessLocalSdp(string sdp)
        {
            var lines = sdp.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            var output = new List<string>();
            string opusPayload = null;
            bool inAudioSection = false;

            foreach (var line in lines)
            {
                if (line.StartsWith("m=audio")) { inAudioSection = true; output.Add(line); continue; }
                if (inAudioSection && line.StartsWith("m=")) { inAudioSection = false; }

                if (line.Contains("opus/48000"))
                {
                    var match = Regex.Match(line, @"a=rtpmap:(\d+)\s+opus");
                    if (match.Success) { opusPayload = match.Groups[1].Value; output.Add($"a=rtpmap:{opusPayload} opus/48000/2"); continue; }
                }

                if (!string.IsNullOrEmpty(opusPayload) && line.StartsWith($"a=fmtp:{opusPayload}"))
                {
                    var fmtp = "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxplaybackrate=48000";
                    output.Add($"a=fmtp:{opusPayload} {fmtp}");
                    continue;
                }

                output.Add(line);
            }

            return string.Join("\r\n", output);
        }

        private string SanitizeRemoteSdp(string sdp)
        {
            if (string.IsNullOrEmpty(sdp)) return sdp;
            var sb = new StringBuilder();
            var lines = sdp.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines)
            {
                if (line.StartsWith("a=candidate:", StringComparison.OrdinalIgnoreCase) && Regex.IsMatch(line, "\\s0\\s"))
                {
                    _log.Debug($"Dropping remote ICE candidate with port 0: {line}");
                    continue;
                }
                sb.AppendLine(line);
            }
            return sb.ToString();
        }

        private async Task AttemptReprovisionAsync()
        {
            if (!await reprovisionLock.WaitAsync(0)) return;

            try
            {
                bool wasRecording = AudioDevice?.Source != null && AudioDevice.RecordingActive;

                if (AudioDevice != null) { try { AudioDevice.StopRecording(); } catch { } try { AudioDevice.StopPlaybackAsync().Wait(250); } catch { } }

                if (PeerConnection != null)
                {
                    if (AudioDevice != null) try { AudioDevice.OnAudioSourceEncodedSample -= PeerConnection.SendAudio; } catch { }
                    try { PeerConnection.Close("Reprovision"); } catch { }
                }

                try { iceTrickleCts?.Cancel(); } catch { }
                answerReceived = false;
                try { peerManager.ClearAllPeers(); } catch { }

                var newPc = await CreatePeerConnection();
                PeerConnection = newPc;
                _ = IceTrickleStart();

                var ok = await RequestProvision();
                if (ok)
                {
                    _log.Debug($"Reprovision completed, new session {SessionId}");
                    await Task.Delay(500).ConfigureAwait(false);
                    if (wasRecording) try { AudioDevice.StartRecording(); } catch { }
                    try { OnReprovisionSucceeded?.Invoke(); } catch { }
                }
                else
                {
                    try { OnReprovisionFailed?.Invoke(new Exception("Not connected")); } catch { }
                }
            }
            finally { reprovisionLock.Release(); }
        }

        public async Task<bool> RequestProvision()
        {
            if (!Context.Connected) return false;

            var cap = Context.GetCapability(PROVISION_VOICE_ACCOUNT_CAP);
            if (cap == null) throw new VoiceException($"No {PROVISION_VOICE_ACCOUNT_CAP} capability available.");

            switch (SessionType)
            {
                case ESessionType.LOCAL:
                    await RequestLocalVoiceProvision(cap);
                    break;
                case ESessionType.MUTLIAGENT:
                    await RequestMultiAgentVoiceProvision(cap);
                    break;
            }

            return true;
        }

        private async Task RequestLocalVoiceProvision(Uri cap)
        {
            var parcelId = Context.ParcelLocalId;
            var payload = new LocalVoiceProvisionRequest(SdpLocal, parcelId).Serialize();

            var osd = await PostCapsWithRetries(cap, payload).ConfigureAwait(false);
            if (osd is OSDMap osdMap)
            {
                if (!osdMap.TryGetValue("jsep", out var j))
                    throw new VoiceException($"Region '{Context.RegionName}' does not support WebRtc.");

                var jsep = (OSDMap)j;
                var sdpString = SanitizeRemoteSdp(jsep["sdp"].AsString());
                var sessionId = osdMap.ContainsKey("viewer_session") ? osdMap["viewer_session"].AsUUID() : UUID.Zero;
                SessionId = sessionId;

                if (PeerConnection == null) throw new VoiceException("Internal error: PeerConnection was null.");
                var set = PeerConnection.SetRemoteDescription(SdpType.answer, SDP.ParseSDPDescription(sdpString));
                if (set != SetDescriptionResultEnum.OK)
                {
                    PeerConnection.Close("Failed to set remote description.");
                    throw new VoiceException("Failed to set remote description.");
                }

                answerReceived = true;

                await SendVoiceSignalingRequest().ConfigureAwait(false);

                _ = Task.Run(async () =>
                {
                    try
                    {
                        await Task.Delay(8000).ConfigureAwait(false);
                        if (PeerConnection == null || PeerConnection.connectionState != RTCPeerConnectionState.connected)
                        {
                            _log.Warn("PeerConnection did not connect after provisioning; scheduling reprovision.");
                            ScheduleReprovisionWithBackoff();
                        }
                    }
                    catch { }
                });

                if (osdMap.ContainsKey("channel")) ChannelId = osdMap["channel"].AsString();
                if (osdMap.ContainsKey("credentials")) ChannelCredentials = osdMap["credentials"].AsString();

                _log.Info($"Local voice provisioned: session={sessionId}");
                if (!sdpString.Contains("m=audio")) _log.Warn("Remote SDP has no audio track");
            }
        }

        private async Task RequestMultiAgentVoiceProvision(Uri cap)
        {
            var req = new MultiAgentVoiceProvisionRequest(SdpLocal);
            if (!string.IsNullOrEmpty(ChannelId)) req.ChannelId = ChannelId;
            if (!string.IsNullOrEmpty(ChannelCredentials)) req.ChannelCredentials = ChannelCredentials;

            var osd = await PostCapsWithRetries(cap, req.Serialize()).ConfigureAwait(false);
            if (osd is OSDMap osdMap)
            {
                if (!osdMap.ContainsKey("jsep"))
                    throw new VoiceException($"Region '{Context.RegionName}' does not support WebRtc.");

                var jsep = (OSDMap)osdMap["jsep"];
                var sdpString = SanitizeRemoteSdp(jsep["sdp"].AsString());
                var sessionId = osdMap.ContainsKey("viewer_session") ? osdMap["viewer_session"].AsUUID() : UUID.Zero;

                var set = PeerConnection.SetRemoteDescription(SdpType.answer, SDP.ParseSDPDescription(sdpString));
                if (set != SetDescriptionResultEnum.OK)
                {
                    PeerConnection.Close("Failed to set remote description (multiagent).");
                    throw new VoiceException("Failed to set remote description (multiagent).");
                }

                SessionId = sessionId;
                answerReceived = true;

                _ = Task.Run(async () =>
                {
                    try
                    {
                        await Task.Delay(8000).ConfigureAwait(false);
                        if (PeerConnection == null || PeerConnection.connectionState != RTCPeerConnectionState.connected)
                            ScheduleReprovisionWithBackoff();
                    }
                    catch { }
                });

                if (osdMap.ContainsKey("channel")) ChannelId = osdMap["channel"].AsString();
                if (osdMap.ContainsKey("credentials")) ChannelCredentials = osdMap["credentials"].AsString();

                _log.Info($"Multi-agent voice provisioned: session={sessionId}");
            }
        }

        private int _positionUpdateCount = 0;
        private void SendPositionUpdate(RTCDataChannel dc, Vector3 pos, Quaternion heading)
        {
            if (!mSpatialCoordsDirty) return;
            if (pos == lastSentPos && heading == lastSentHeading) { mSpatialCoordsDirty = false; return; }
            _positionUpdateCount++;
            if (_positionUpdateCount == 1)
                _log.Debug($"Position update: pos=({pos.X:F1},{pos.Y:F1},{pos.Z:F1})");

            try
            {
                int posX = (int)Math.Round(pos.X * 100);
                int posY = (int)Math.Round(pos.Y * 100);
                int posZ = (int)Math.Round(pos.Z * 100);
                int headX = (int)Math.Round(heading.X * 100);
                int headY = (int)Math.Round(heading.Y * 100);
                int headZ = (int)Math.Round(heading.Z * 100);
                int headW = (int)Math.Round(heading.W * 100);

                var jw = new JsonWriter();
                jw.WriteObjectStart();
                jw.WritePropertyName("sp"); jw.WriteObjectStart();
                jw.WritePropertyName("x"); jw.Write(posX);
                jw.WritePropertyName("y"); jw.Write(posY);
                jw.WritePropertyName("z"); jw.Write(posZ);
                jw.WriteObjectEnd();
                jw.WritePropertyName("sh"); jw.WriteObjectStart();
                jw.WritePropertyName("x"); jw.Write(headX);
                jw.WritePropertyName("y"); jw.Write(headY);
                jw.WritePropertyName("z"); jw.Write(headZ);
                jw.WritePropertyName("w"); jw.Write(headW);
                jw.WriteObjectEnd();
                jw.WritePropertyName("lp"); jw.WriteObjectStart();
                jw.WritePropertyName("x"); jw.Write(posX);
                jw.WritePropertyName("y"); jw.Write(posY);
                jw.WritePropertyName("z"); jw.Write(posZ);
                jw.WriteObjectEnd();
                jw.WritePropertyName("lh"); jw.WriteObjectStart();
                jw.WritePropertyName("x"); jw.Write(headX);
                jw.WritePropertyName("y"); jw.Write(headY);
                jw.WritePropertyName("z"); jw.Write(headZ);
                jw.WritePropertyName("w"); jw.Write(headW);
                jw.WriteObjectEnd();
                jw.WriteObjectEnd();

                TrySendDataChannelString(jw.ToString());
                lastSentPos = pos;
                lastSentHeading = heading;
                mSpatialCoordsDirty = false;
            }
            catch (Exception ex) { _log.Warn($"Failed to send position: {ex.Message}"); }
        }

        private async Task SendCloseSessionRequest()
        {
            var cap = Context.GetCapability(PROVISION_VOICE_ACCOUNT_CAP);
            if (cap == null) return;

            var payload = new OSDMap
            {
                { "logout", true },
                { "voice_server_type", "webrtc" },
                { "viewer_session", SessionId }
            };

            try
            {
                if (!string.IsNullOrEmpty(ChannelId))
                {
                    payload["channel"] = ChannelId;
                    if (!string.IsNullOrEmpty(ChannelCredentials)) payload["credentials"] = ChannelCredentials;
                }
                await PostCapsWithRetries(cap, payload).ConfigureAwait(false);
            }
            catch (Exception ex) { _log.Error($"Close session request failed: {ex.Message}"); }

            ChannelId = null;
            ChannelCredentials = null;
        }

        public async Task CloseSession()
        {
            StopPositionLoop();
            StopKeepAliveLoop();
            try { peerManager.ClearAllPeers(); } catch { }
            PeerConnection?.Close("ClientClose");
            await SendCloseSessionRequest().ConfigureAwait(false);
            await SendVoiceSignalingCompleteRequest().ConfigureAwait(false);
            try { Cts.Cancel(); } catch { }
        }

        private volatile bool _disposed = false;

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (_disposed) return;
            _disposed = true;

            if (disposing)
            {
                try { StopPositionLoop(); } catch { }
                try { StopKeepAliveLoop(); } catch { }
                try { iceTrickleCts?.Cancel(); try { iceTrickleTask?.Wait(250); } catch { } iceTrickleCts?.Dispose(); } catch { }
                try { if (AudioDevice != null) AudioDevice.OnAudioSourceEncodedSample -= PeerConnection.SendAudio; } catch { }
                try { AudioDevice?.StopRecording(); } catch { }
                try { AudioDevice?.StopPlaybackAsync().Wait(250); } catch { }
                try { peerManager.ClearAllPeers(); } catch { }
                try { PeerConnection?.Close("Dispose"); (PeerConnection as IDisposable)?.Dispose(); PeerConnection = null; } catch { }
                try { Cts.Cancel(); } catch { }
                try { Cts.Dispose(); } catch { }
                try { positionLoopCts?.Dispose(); } catch { }
                try { keepAliveLoopCts?.Dispose(); } catch { }
                try { reprovisionLock.Dispose(); } catch { }
            }
        }

        ~VoiceSession() { Dispose(false); }
    }
}
