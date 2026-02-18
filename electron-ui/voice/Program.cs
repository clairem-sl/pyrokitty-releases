/*
 * VoiceSidecar entry point — JSON-over-stdin/stdout IPC.
 *
 * stdin:  one JSON object per line (commands from Electron)
 * stdout: one JSON object per line (events to Electron)
 * stderr: human-readable log output
 */

using Microsoft.Extensions.Logging;
using OpenMetaverse;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace VoiceSidecar
{
    internal class Program
    {
        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false,
        };

        private static readonly object WriteLock = new();
        private static readonly IVoiceLogger Log = new ConsoleVoiceLogger();

        static Program()
        {
            // Enable SIPSorcery internal logging so we can see SRTP/RTP errors
            var factory = LoggerFactory.Create(builder =>
            {
                builder.AddProvider(new VoiceLoggerProvider(Log));
                builder.SetMinimumLevel(LogLevel.Debug);
                // Suppress extremely verbose SCTP data channel chatter
                builder.AddFilter("SIPSorcery.Net.SctpDataSender", LogLevel.Warning);
                builder.AddFilter("SIPSorcery.Net.SctpDataReceiver", LogLevel.Warning);
            });
            SIPSorcery.LogFactory.Set(factory);
        }
        private static readonly JsonIpcContext Context = new();

        private static Sdl3Audio _audio;
        private static VoiceSession _session;
        private static CancellationTokenSource _cts;
        private static Timer _micLevelTimer;

        static async Task Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            {
                Log.Error($"Unhandled exception: {e.ExceptionObject}");
                Emit("error", new { message = $"Unhandled: {e.ExceptionObject}" });
            };

            try
            {
                _audio = new Sdl3Audio(Log);
                if (!_audio.IsAvailable)
                    Log.Warn("SDL3 audio not available — voice will not work");
            }
            catch (Exception ex)
            {
                Log.Error($"Failed to initialize audio: {ex.Message}");
                _audio = null;
            }

            // Emit mic level at ~10Hz for UI meter
            if (_audio != null)
            {
                _micLevelTimer = new Timer(_ =>
                {
                    if (_audio != null && _audio.RecordingActive && !_audio.MicGated)
                        Emit("micLevel", new { level = _audio.MicLevel });
                }, null, 100, 100);
            }

            Emit("ready", null);

            // Read stdin line-by-line
            string line;
            while ((line = await ReadLineAsync().ConfigureAwait(false)) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    var root = doc.RootElement;
                    var cmd = root.GetProperty("cmd").GetString();
                    await HandleCommand(cmd, root).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    Log.Error($"Command error: {ex.Message}");
                    Emit("error", new { message = ex.Message });
                }
            }

            // stdin closed — clean up
            await DisconnectAsync().ConfigureAwait(false);
            _audio?.Dispose();
        }

        private static async Task HandleCommand(string cmd, JsonElement root)
        {
            switch (cmd)
            {
                case "connect":
                    await ConnectAsync(root).ConfigureAwait(false);
                    break;

                case "updatePosition":
                    UpdatePosition(root);
                    break;

                case "disconnect":
                    await DisconnectAsync().ConfigureAwait(false);
                    break;

                case "setMicMute":
                    SetMicMute(root);
                    break;

                case "setVolume":
                    SetVolume(root);
                    break;

                case "playFile":
                    PlayFile(root);
                    break;

                case "stopFile":
                    _audio?.StopFilePlayback();
                    break;

                case "listAudioDevices":
                    ListAudioDevices();
                    break;

                case "setInputDevice":
                    SetInputDevice(root);
                    break;

                case "setOutputDevice":
                    SetOutputDevice(root);
                    break;

                default:
                    Log.Warn($"Unknown command: {cmd}");
                    Emit("error", new { message = $"Unknown command: {cmd}" });
                    break;
            }
        }

        // ── connect ──────────────────────────────────────────────

        private static async Task ConnectAsync(JsonElement root)
        {
            // Tear down any existing session
            await DisconnectAsync().ConfigureAwait(false);

            // Parse caps
            var capsEl = root.GetProperty("caps");
            var caps = new Dictionary<string, string>();
            foreach (var prop in capsEl.EnumerateObject())
                caps[prop.Name] = prop.Value.GetString();

            Context.SetCaps(caps);

            if (root.TryGetProperty("agentId", out var aid))
                Context.AgentId = aid.GetString();
            if (root.TryGetProperty("sessionId", out var sid))
                Context.SessionId = sid.GetString();
            if (root.TryGetProperty("regionName", out var rn))
                Context.RegionName = rn.GetString();
            if (root.TryGetProperty("parcelLocalId", out var plid))
                Context.ParcelLocalId = plid.GetInt32();

            // Apply position if provided alongside connect
            if (root.TryGetProperty("position", out var posEl))
                Context.AgentPosition = ParseVector3(posEl);
            if (root.TryGetProperty("rotation", out var rotEl))
                Context.AgentRotation = ParseQuaternion(rotEl);

            if (_audio == null || !_audio.IsAvailable)
            {
                Emit("error", new { message = "Audio not available" });
                return;
            }

            _cts = new CancellationTokenSource();

            // Spatial voice always uses LOCAL. MULTIAGENT is only for P2P/Group/AdHoc calls.
            // ParcelVoiceInfoRequest is a Vivox-era cap — Firestorm's WebRTC code never uses it.
            var sessionType = VoiceSession.ESessionType.LOCAL;
            Log.Info($"Using local voice (parcelLocalId={Context.ParcelLocalId})");

            try
            {
                _session = new VoiceSession(_audio, sessionType, Context, Log);

                _session.OnPeerJoined += id => Emit("participantJoined", new { agentId = id.ToString() });
                _session.OnPeerLeft += id => Emit("participantLeft", new { agentId = id.ToString() });
                _session.OnPeerAudioUpdated += (id, state) =>
                {
                    if (state.Power.HasValue)
                        Emit("participantSpeaking", new { agentId = id.ToString(), power = state.Power.Value });
                };
                _session.OnPeerConnectionReady += () =>
                {
                    Emit("connected", new { channel = "spatial" });
                };
                _session.OnPeerConnectionClosed += () => Emit("disconnected", new { reason = "peerClosed" });
                _session.OnReprovisionSucceeded += () => Emit("connected", new { channel = "spatial" });
                _session.OnReprovisionFailed += ex => Emit("disconnected", new { reason = ex?.Message ?? "reprovisionFailed" });

                await _session.StartAsync(_cts.Token).ConfigureAwait(false);
                await _session.RequestProvision().ConfigureAwait(false);

                Log.Info("Voice session started");
            }
            catch (Exception ex)
            {
                Log.Error($"Connect failed: {ex.Message}");
                Emit("error", new { message = $"Connect failed: {ex.Message}" });
                await DisconnectAsync().ConfigureAwait(false);
            }
        }

        // ── disconnect ───────────────────────────────────────────

        private static async Task DisconnectAsync()
        {
            if (_session != null)
            {
                try { await _session.CloseSession().ConfigureAwait(false); } catch { }
                try { _session.Dispose(); } catch { }
                _session = null;
            }

            try { _cts?.Cancel(); } catch { }
            try { _cts?.Dispose(); } catch { }
            _cts = null;

            Context.Disconnect();
        }

        // ── updatePosition ───────────────────────────────────────

        private static int _posUpdateCount = 0;
        private static void UpdatePosition(JsonElement root)
        {
            if (root.TryGetProperty("position", out var posEl))
                Context.AgentPosition = ParseVector3(posEl);
            if (root.TryGetProperty("rotation", out var rotEl))
                Context.AgentRotation = ParseQuaternion(rotEl);
            if (root.TryGetProperty("regionName", out var rn))
                Context.RegionName = rn.GetString();
            if (root.TryGetProperty("parcelLocalId", out var plid))
                Context.ParcelLocalId = plid.GetInt32();

            _posUpdateCount++;
            if (_posUpdateCount <= 3)
                Log.Debug($"UpdatePosition #{_posUpdateCount}: pos=({Context.AgentPosition.X:F1},{Context.AgentPosition.Y:F1},{Context.AgentPosition.Z:F1})");
        }

        // ── audio controls ──────────────────────────────────────

        private static void SetMicMute(JsonElement root)
        {
            var muted = root.GetProperty("muted").GetBoolean();
            if (_audio != null) _audio.MicGated = muted;
        }

        private static void SetVolume(JsonElement root)
        {
            var vol = (float)root.GetProperty("volume").GetDouble();
            if (_audio != null) _audio.SpeakerLevel = vol;
        }

        private static void PlayFile(JsonElement root)
        {
            var path = root.GetProperty("path").GetString();
            var loop = root.TryGetProperty("loop", out var lp) && lp.GetBoolean();
            _audio?.StartFilePlayback(path, loop);
        }

        private static void ListAudioDevices()
        {
            if (_audio == null || !_audio.IsAvailable)
            {
                Emit("audioDevices", new { inputs = Array.Empty<object>(), outputs = Array.Empty<object>() });
                return;
            }

            var inputs = _audio.GetRecordingDevices()
                .Select(d => new { id = d.Key, name = d.Value }).ToArray();
            var outputs = _audio.GetPlaybackDevices()
                .Select(d => new { id = d.Key, name = d.Value }).ToArray();

            Emit("audioDevices", new { inputs, outputs });
        }

        private static void SetInputDevice(JsonElement root)
        {
            var name = root.GetProperty("deviceName").GetString();
            _audio?.SetRecordingDevice(name);
        }

        private static void SetOutputDevice(JsonElement root)
        {
            var name = root.GetProperty("deviceName").GetString();
            _audio?.SetPlaybackDevice(name);
        }

        // ── helpers ──────────────────────────────────────────────

        private static void Emit(string eventName, object data)
        {
            try
            {
                string line;
                if (data != null)
                {
                    // Serialize data, then merge "event" key in at the string level
                    // to avoid JsonDocument lifetime issues
                    var json = JsonSerializer.Serialize(data, JsonOpts);
                    // Insert "event":"name" at the start of the JSON object
                    var eventKey = JsonSerializer.Serialize(eventName);
                    line = "{\"event\":" + eventKey + "," + json.Substring(1);
                }
                else
                {
                    line = JsonSerializer.Serialize(new Dictionary<string, string> { ["event"] = eventName }, JsonOpts);
                }
                lock (WriteLock)
                {
                    Console.Out.WriteLine(line);
                    Console.Out.Flush();
                }
            }
            catch (Exception ex)
            {
                Log.Error($"Emit failed: {ex.Message}");
            }
        }

        private static Vector3 ParseVector3(JsonElement el)
        {
            if (el.ValueKind == JsonValueKind.Array)
            {
                var x = (float)el[0].GetDouble();
                var y = (float)el[1].GetDouble();
                var z = (float)el[2].GetDouble();
                return new Vector3(x, y, z);
            }
            return new Vector3(
                (float)el.GetProperty("x").GetDouble(),
                (float)el.GetProperty("y").GetDouble(),
                (float)el.GetProperty("z").GetDouble()
            );
        }

        private static Quaternion ParseQuaternion(JsonElement el)
        {
            if (el.ValueKind == JsonValueKind.Array)
            {
                var x = (float)el[0].GetDouble();
                var y = (float)el[1].GetDouble();
                var z = (float)el[2].GetDouble();
                var w = (float)el[3].GetDouble();
                return new Quaternion(x, y, z, w);
            }
            return new Quaternion(
                (float)el.GetProperty("x").GetDouble(),
                (float)el.GetProperty("y").GetDouble(),
                (float)el.GetProperty("z").GetDouble(),
                (float)el.GetProperty("w").GetDouble()
            );
        }

        private static async Task<string> ReadLineAsync()
        {
            try
            {
                return await Console.In.ReadLineAsync().ConfigureAwait(false);
            }
            catch
            {
                return null;
            }
        }
    }
}
