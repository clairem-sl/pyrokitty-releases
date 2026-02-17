/*
 * Adapted from LibreMetaverse/Sdl3Audio.cs
 * Copyright (c) 2025, Sjofn LLC - BSD License
 *
 * Modified for standalone sidecar: namespace changed, logger default updated.
 * Cleaned up: removed dead raw PCM APIs, reflection hacks, unused wrappers.
 */

using SIPSorceryMedia.Abstractions;
using SIPSorceryMedia.SDL3;
using System;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.IO;
using System.Threading;
using System.Collections.Concurrent;

namespace VoiceSidecar
{
    public class Sdl3Audio : IDisposable
    {
        public SDL3AudioEndPoint EndPoint { get; private set; }
        public SDL3AudioSource Source { get; private set; }

        // Separate encoder instances to avoid Concentus internal state corruption:
        // _audioEncoder: EndPoint construction + RTP decode (playback)
        // _sourceEncoder: SDL3AudioSource constructor (required by API, but Source never actually encodes)
        // _micEncoder: manual mic encoding in raw sample handler
        // File playback creates a fresh instance per-playback in StartFilePlayback
        private readonly OpusAudioEncoder _audioEncoder = new();
        private readonly OpusAudioEncoder _sourceEncoder = new();
        private readonly OpusAudioEncoder _micEncoder = new();

        public bool IsAvailable { get; } = false;

        public event Action<bool> OnPlaybackActiveChanged;
        public event Action<bool> OnRecordingActiveChanged;

        /// <summary>Encoded audio samples ready to send via RTP. Wired to pc.SendAudio in VoiceSession.</summary>
        public event Action<uint, byte[]> OnAudioSourceEncodedSample;

        public bool PlaybackActive { get; private set; } = false;
        public bool RecordingActive { get; private set; } = false;

        /// <summary>Peak mic input level (0.0-1.0), updated from raw sample callback.</summary>
        public float MicLevel { get; private set; } = 0f;

        /// <summary>When true, encoded mic samples are not forwarded (PTT gate). Recording stays active.</summary>
        public bool MicGated { get; set; } = true;

        public (uint id, string name) PlaybackDevice { get; private set; }
        public (uint id, string name) RecordingDevice { get; private set; }

        private float _speakerLevel = 1.0f;
        public float SpeakerLevel
        {
            get => _speakerLevel;
            set => _speakerLevel = Math.Max(0f, Math.Min(1f, value));
        }

        private const int OPUS_FRAME_SIZE = 960; // 20ms at 48kHz

        private readonly IVoiceLogger _log;

        public Sdl3Audio(IVoiceLogger logger = null)
        {
            _log = logger ?? new ConsoleVoiceLogger();

            try
            {
                SDL3Helper.InitSDL();
                _log.Debug("SDL3 initialized successfully");

                var playbackDeviceIndex = DeviceSelection(false);
                var recordingDeviceIndex = DeviceSelection(true);
                PlaybackDevice = GetDevice(playbackDeviceIndex, false) ?? (id: 0, name: string.Empty);
                RecordingDevice = GetDevice(recordingDeviceIndex, true) ?? (id: 0, name: string.Empty);

                // EndPoint is created lazily in EnsureEndpoint() when first RTP arrives.
                // Creating it here starts the SDL3 stream callback immediately, causing
                // buffer underrun spam when nobody is talking.

                try
                {
                    Source = new SDL3AudioSource(RecordingDevice.name, _sourceEncoder);
                    Source.OnAudioSourceRawSample += AudioSource_OnAudioSourceRawSample;
                }
                catch (Exception ex)
                {
                    _log.Warn($"Failed to create audio source (recording may not work): {ex.Message}");
                    Source = null;
                }

                IsAvailable = true;
            }
            catch (Exception ex)
            {
                _log.Error($"SDL3 initialization failed: {ex.Message}");
                IsAvailable = false;
            }
        }

        public void Dispose()
        {
            try
            {
                if (PlaybackActive) { _ = StopPlaybackAsync(); }
                if (RecordingActive) StopRecording();
                if (IsAvailable) SDL3Helper.QuitSDL();
            }
            catch { }
        }

        // ── Recording (mic capture) ─────────────────────────────────

        public void StartRecording()
        {
            if (!IsAvailable || Source == null) return;
            try
            {
                // SetAudioSourceFormat must be called to initialize the SDL3 capture stream.
                // Without it, StartAudio() is a no-op (no _audioStream exists yet).
                var formats = Source.GetAudioSourceFormats();
                if (formats != null && formats.Count > 0)
                {
                    Source.SetAudioSourceFormat(formats[0]);
                    _log.Debug($"Recording source initialized with: {formats[0].FormatName}");
                }

                Source.StartAudio();
                RecordingActive = true;
                OnRecordingActiveChanged?.Invoke(true);
                _log.Debug("Recording started");
            }
            catch (Exception ex)
            {
                _log.Error($"Failed to start recording: {ex.Message}");
            }
        }

        public void StopRecording()
        {
            if (!IsAvailable || Source == null) return;
            try
            {
                Source.CloseAudio();
                RecordingActive = false;
                OnRecordingActiveChanged?.Invoke(false);
                _log.Debug("Recording stopped");
            }
            catch (Exception ex)
            {
                _log.Error($"Failed to stop recording: {ex.Message}");
            }
        }

        // Manual mic encoding buffer
        // SDL3AudioSource.OnAudioSourceEncodedSample never fires despite SetAudioSourceFormat(opus).
        // Only OnAudioSourceRawSample works, so we manually encode in 20ms frames here.
        private short[] _micBuffer = Array.Empty<short>();
        private int _micBufferPos = 0;
        private int _micEncodeCount = 0;

        public void AudioSource_OnAudioSourceRawSample(AudioSamplingRatesEnum samplingRate, uint durationMilliseconds, short[] sample)
        {
            if (sample == null || sample.Length == 0) return;

            // Track peak mic level for UI meter
            int peak = 0;
            for (int i = 0; i < sample.Length; i++)
            {
                int abs = Math.Abs((int)sample[i]);
                if (abs > peak) peak = abs;
            }
            MicLevel = Math.Min(1.0f, peak / 32768f);

            // Manual Opus encoding: buffer into 960-sample frames, encode.
            // NOTE: SDL3 captures at 48kHz regardless of what AudioSamplingRatesEnum says.
            // The Rate8KHz enum is misleading - actual data is 48kHz (488 samples per 10ms callback).
            // Do NOT resample - feed directly to the Opus encoder.
            if (MicGated) return;

            if (_micBuffer.Length == 0)
                _micBuffer = new short[OPUS_FRAME_SIZE];

            int srcIdx = 0;
            while (srcIdx < sample.Length)
            {
                int toCopy = Math.Min(sample.Length - srcIdx, OPUS_FRAME_SIZE - _micBufferPos);
                Array.Copy(sample, srcIdx, _micBuffer, _micBufferPos, toCopy);
                _micBufferPos += toCopy;
                srcIdx += toCopy;

                if (_micBufferPos >= OPUS_FRAME_SIZE)
                {
                    try
                    {
                        var encoded = _micEncoder.EncodeAudio(_micBuffer, OpusAudioEncoder.MEDIA_FORMAT_OPUS);
                        if (encoded != null && encoded.Length > 0)
                        {
                            _micEncodeCount++;
                            if (_micEncodeCount == 1)
                                _log.Debug($"Mic encoding started (len={encoded.Length})");
                            try { OnAudioSourceEncodedSample?.Invoke((uint)OPUS_FRAME_SIZE, encoded); } catch { }
                        }
                    }
                    catch (Exception ex)
                    {
                        if (_micEncodeCount < 3)
                            _log.Warn($"Mic encode failed: {ex.Message}");
                    }
                    _micBufferPos = 0;
                }
            }
        }

        // ── Playback (speaker output) ───────────────────────────────

        // Endpoint sink format: mono 48kHz 16-bit PCM to match Opus decoder output (_channels=1)
        private static readonly AudioFormat ENDPOINT_FORMAT = new(AudioCodecsEnum.L16, 96, 48000, 1);

        public bool EnsureEndpoint()
        {
            if (!IsAvailable) return false;
            if (EndPoint != null) return true;

            try
            {
                EndPoint = new SDL3AudioEndPoint(PlaybackDevice.name, _audioEncoder);
                EndPoint.SetAudioSinkFormat(ENDPOINT_FORMAT);
                _log.Debug("SDL3AudioEndPoint created (mono 48kHz)");
                return true;
            }
            catch (Exception ex)
            {
                _log.Error($"Failed to create SDL3AudioEndPoint: {ex.Message}");
                EndPoint = null;
                return false;
            }
        }

        public async Task StartPlaybackAsync()
        {
            if (!EnsureEndpoint()) return;
            try
            {
                await EndPoint.StartAudioSink();
                PlaybackActive = true;
                OnPlaybackActiveChanged?.Invoke(true);
                _log.Debug("Playback started");
            }
            catch (Exception ex)
            {
                _log.Error($"Failed to start playback: {ex.Message}");
            }
        }

        public async Task StopPlaybackAsync()
        {
            if (!IsAvailable || EndPoint == null) return;
            try
            {
                await EndPoint.CloseAudioSink();
                PlaybackActive = false;
                OnPlaybackActiveChanged?.Invoke(false);
                _log.Debug("Playback stopped");
            }
            catch (Exception ex)
            {
                _log.Error($"Failed to stop playback: {ex.Message}");
            }
        }

        // ── RTP playback (incoming voice from other avatars) ────────

        private readonly ConcurrentDictionary<uint, float> _ssrcGain = new();
        private readonly ConcurrentDictionary<uint, bool> _ssrcMuted = new();

        public void SetSsrcMute(uint ssrc, bool muted)
        {
            if (muted) _ssrcMuted[ssrc] = true;
            else _ssrcMuted.TryRemove(ssrc, out _);
        }

        public void SetSsrcGainPercent(uint ssrc, int percent)
        {
            percent = Math.Max(0, Math.Min(200, percent));
            _ssrcGain[ssrc] = percent / 100f;
        }

        public void ClearSsrc(uint ssrc)
        {
            _ssrcGain.TryRemove(ssrc, out _);
            _ssrcMuted.TryRemove(ssrc, out _);
        }

        private int _rtpPlayCount = 0;

        public void PlayRtpPacket(uint ssrc, byte[] payload)
        {
            if (payload == null || payload.Length == 0) return;
            try
            {
                _rtpPlayCount++;
                if (_rtpPlayCount == 1)
                    _log.Debug($"Receiving voice audio (ssrc={ssrc})");

                if (_ssrcMuted.TryGetValue(ssrc, out var muted) && muted) return;

                var pcmSample = _audioEncoder.DecodeAudio(payload, OpusAudioEncoder.MEDIA_FORMAT_OPUS);
                if (pcmSample == null || pcmSample.Length == 0) return;

                // Apply per-SSRC gain and master speaker level
                float gain = _speakerLevel;
                if (_ssrcGain.TryGetValue(ssrc, out var ssrcGain))
                    gain *= ssrcGain;

                if (Math.Abs(gain - 1.0f) > 0.0001f)
                {
                    for (int i = 0; i < pcmSample.Length; i++)
                    {
                        int v = (int)Math.Round(pcmSample[i] * gain);
                        pcmSample[i] = (short)Math.Clamp(v, short.MinValue, short.MaxValue);
                    }
                }

                var pcmBytes = pcmSample.SelectMany(BitConverter.GetBytes).ToArray();

                // Lazy endpoint + playback start on first RTP packet
                if (EndPoint == null && !EnsureEndpoint()) return;
                if (!PlaybackActive)
                {
                    _log.Debug("PlayRtpPacket: auto-starting playback");
                    _ = StartPlaybackAsync();
                }

                EndPoint.PutAudioSample(pcmBytes);
            }
            catch (Exception ex)
            {
                _log.Debug($"PlayRtpPacket failed: {ex.Message}");
            }
        }

        // ── File playback (WAV → Opus → RTP) ───────────────────────

        private Task _filePlaybackTask;
        private CancellationTokenSource _filePlaybackCts;
        private bool _filePlaybackLoop = false;
        private bool _filePlaybackActive = false;
        private bool _filePlaybackWasRecording = false;

        public void StartFilePlayback(string path, bool loop = false)
        {
            if (!IsAvailable) throw new InvalidOperationException("SDL3 audio not available");
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("path");
            if (!File.Exists(path)) throw new FileNotFoundException(path);

            StopFilePlayback();

            _log.Debug($"StartFilePlayback: {path} (loop={loop})");

            _filePlaybackWasRecording = RecordingActive;
            if (RecordingActive) { try { StopRecording(); } catch { } }

            _filePlaybackLoop = loop;
            _filePlaybackCts = new CancellationTokenSource();
            var token = _filePlaybackCts.Token;
            _filePlaybackActive = true;

            _filePlaybackTask = Task.Run(async () =>
            {
                try
                {
                    while (!token.IsCancellationRequested)
                    {
                        await PlayWavFileAsync(path, token).ConfigureAwait(false);
                        if (!_filePlaybackLoop) break;
                        _log.Debug("StartFilePlayback: looping...");
                    }
                }
                catch (OperationCanceledException) { }
                catch (Exception ex)
                {
                    _log.Warn($"File playback failed: {ex.Message}");
                }
                finally
                {
                    _filePlaybackActive = false;
                    if (_filePlaybackWasRecording) { try { StartRecording(); } catch { } }
                }
            }, token);
        }

        public void StopFilePlayback()
        {
            if (!_filePlaybackActive || _filePlaybackCts == null) return;
            try { _filePlaybackCts.Cancel(); _filePlaybackTask?.Wait(500); }
            catch { }
            finally { _filePlaybackCts?.Dispose(); _filePlaybackCts = null; _filePlaybackActive = false; }
        }

        private async Task PlayWavFileAsync(string path, CancellationToken ct)
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read);
            using var br = new BinaryReader(fs);

            // Parse WAV header
            if (new string(br.ReadChars(4)) != "RIFF") throw new InvalidDataException("Not a WAV file (missing RIFF)");
            br.ReadInt32(); // file size
            if (new string(br.ReadChars(4)) != "WAVE") throw new InvalidDataException("Not a WAV file (missing WAVE)");

            int channels = 1, sampleRate = 48000;
            short bitsPerSample = 16;
            long dataChunkPos = -1;

            while (fs.Position < fs.Length)
            {
                var chunkId = new string(br.ReadChars(4));
                int chunkSize = br.ReadInt32();

                if (chunkId == "fmt ")
                {
                    br.ReadInt16(); // audio format
                    channels = br.ReadInt16();
                    sampleRate = br.ReadInt32();
                    br.ReadInt32(); // byte rate
                    br.ReadInt16(); // block align
                    bitsPerSample = br.ReadInt16();
                    int remaining = chunkSize - 16;
                    if (remaining > 0) br.ReadBytes(remaining);
                }
                else if (chunkId == "data")
                {
                    dataChunkPos = fs.Position;
                    break;
                }
                else
                {
                    br.ReadBytes(chunkSize);
                }
            }

            if (dataChunkPos < 0) throw new InvalidDataException("WAV data chunk not found");
            if (bitsPerSample != 16) throw new InvalidDataException($"Only 16-bit PCM WAV supported (got {bitsPerSample})");

            _log.Debug($"WAV: channels={channels}, sampleRate={sampleRate}");

            // Fresh encoder per-playback to avoid shared state corruption
            var fileEncoder = new OpusAudioEncoder();
            int frameSize = fileEncoder.GetFrameSize();
            int bytesPerFrame = frameSize * (bitsPerSample / 8) * channels;

            fs.Position = dataChunkPos;
            int framesProcessed = 0;

            while (!ct.IsCancellationRequested)
            {
                var bytes = br.ReadBytes(bytesPerFrame);
                if (bytes == null || bytes.Length == 0) break;
                if (bytes.Length < bytesPerFrame)
                {
                    var padded = new byte[bytesPerFrame];
                    Array.Copy(bytes, 0, padded, 0, bytes.Length);
                    bytes = padded;
                }

                // Convert bytes to shorts
                short[] pcm = new short[bytes.Length / 2];
                for (int i = 0, si = 0; i < bytes.Length; i += 2)
                    pcm[si++] = BitConverter.ToInt16(bytes, i);

                // Downmix to mono, resample if needed
                short[] mono = DownmixToMono(pcm, channels);
                if (sampleRate != 48000) mono = ResampleTo48k(mono, sampleRate);

                // Encode in frameSize chunks
                int idx = 0;
                while (idx < mono.Length)
                {
                    short[] frame = new short[frameSize];
                    int count = Math.Min(mono.Length - idx, frameSize);
                    Array.Copy(mono, idx, frame, 0, count);

                    try
                    {
                        var encoded = fileEncoder.EncodeAudio(frame, OpusAudioEncoder.MEDIA_FORMAT_OPUS);
                        if (encoded != null && encoded.Length > 0)
                        {
                            OnAudioSourceEncodedSample?.Invoke((uint)frameSize, encoded);
                            framesProcessed++;
                        }
                    }
                    catch (Exception ex)
                    {
                        _log.Warn($"WAV encode failed: {ex.Message}");
                    }

                    idx += frameSize;
                    if (ct.IsCancellationRequested) break;
                }

                // Pace output at ~real-time
                int frames = Math.Max(1, mono.Length / frameSize);
                try { await Task.Delay(20 * frames, ct).ConfigureAwait(false); }
                catch (OperationCanceledException) { break; }
            }

            _log.Debug($"WAV playback finished: {framesProcessed} frames");
        }

        // ── Device management ───────────────────────────────────────

        public IReadOnlyDictionary<uint, string> GetPlaybackDevices() => SDL3Helper.GetAudioPlaybackDevices();
        public IReadOnlyDictionary<uint, string> GetRecordingDevices() => SDL3Helper.GetAudioRecordingDevices();

        public void SetPlaybackDevice(string deviceName)
        {
            if (!IsAvailable) return;
            try
            {
                if (deviceName == "Default Speakers" || deviceName == "Default Microphone") deviceName = null;
                bool wasPlaying = PlaybackActive;

                try { EndPoint?.CloseAudioSink().Wait(2000); } catch { }
                EndPoint = new SDL3AudioEndPoint(deviceName, _audioEncoder);
                EndPoint.SetAudioSinkFormat(ENDPOINT_FORMAT);

                if (wasPlaying) _ = StartPlaybackAsync();
            }
            catch (Exception ex)
            {
                _log.Warn($"Failed to set playback device: {ex.Message}");
            }
        }

        public void SetRecordingDevice(string deviceName)
        {
            if (!IsAvailable) return;
            bool wasRecording = RecordingActive;

            try
            {
                if (Source != null)
                {
                    try { Source.OnAudioSourceRawSample -= AudioSource_OnAudioSourceRawSample; } catch { }
                    try { Source.CloseAudio(); } catch { }
                }

                Source = new SDL3AudioSource(deviceName, _sourceEncoder);
                Source.OnAudioSourceRawSample += AudioSource_OnAudioSourceRawSample;

                if (wasRecording) StartRecording();
            }
            catch (Exception ex)
            {
                _log.Warn($"Failed to set recording device '{deviceName}': {ex.Message}");

                // Fallback to default device
                if (deviceName != null)
                {
                    try
                    {
                        Source = new SDL3AudioSource(null, _sourceEncoder);
                        Source.OnAudioSourceRawSample += AudioSource_OnAudioSourceRawSample;
                        if (wasRecording) StartRecording();
                    }
                    catch (Exception ex2)
                    {
                        _log.Error($"Failed to fallback to default recording device: {ex2.Message}");
                        Source = null;
                        throw;
                    }
                }
                else
                {
                    Source = null;
                    throw;
                }
            }
        }

        // ── Helpers ─────────────────────────────────────────────────

        private int DeviceSelection(bool recordingDevice)
        {
            var devices = recordingDevice ? SDL3Helper.GetAudioRecordingDevices() : SDL3Helper.GetAudioPlaybackDevices();
            if (devices.Count < 1)
                _log.Warn($"SDL Audio - Could not find an audio {(recordingDevice ? "recording" : "playback")} device.");
            return -1; // -1 = use default device
        }

        private (uint id, string name)? GetDevice(int index, bool recordingDevice)
        {
            return index < 0
                ? (recordingDevice ? SDL3Helper.GetAudioRecordingDevice(null) : SDL3Helper.GetAudioPlaybackDevice(null))
                : (recordingDevice ? SDL3Helper.GetAudioRecordingDevice(index) : SDL3Helper.GetAudioPlaybackDevice(index));
        }

        private static short[] ResampleTo48k(short[] src, int srcRate)
        {
            if (src == null || src.Length == 0 || srcRate == 48000) return src ?? Array.Empty<short>();
            double ratio = 48000.0 / srcRate;
            int dstLen = (int)Math.Round(src.Length * ratio);
            if (dstLen < 1) return Array.Empty<short>();

            var dst = new short[dstLen];
            for (int i = 0; i < dstLen; i++)
            {
                double srcPos = i / ratio;
                int i0 = Math.Min((int)Math.Floor(srcPos), src.Length - 1);
                int i1 = Math.Min(i0 + 1, src.Length - 1);
                double frac = srcPos - Math.Floor(srcPos);
                dst[i] = (short)Math.Round(src[i0] * (1.0 - frac) + src[i1] * frac);
            }
            return dst;
        }

        private static short[] DownmixToMono(short[] interleaved, int channels)
        {
            if (channels <= 1) return interleaved;
            int monoLen = interleaved.Length / channels;
            var mono = new short[monoLen];
            for (int i = 0; i < monoLen; i++)
            {
                int acc = 0;
                for (int c = 0; c < channels; c++)
                    acc += interleaved[i * channels + c];
                mono[i] = (short)(acc / channels);
            }
            return mono;
        }
    }
}
