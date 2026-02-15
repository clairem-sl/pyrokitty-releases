/*
 * Adapted from LibreMetaverse.Voice.WebRTC/DataChannelProcessor.cs
 * Copyright (c) 2025, Sjofn LLC - BSD License
 *
 * Modified for standalone sidecar: GridClient removed, Vector3d -> Vector3.
 */

using LitJson;
using OpenMetaverse;
using OpenMetaverse.StructuredData;
using System;
using System.Collections.Generic;

namespace VoiceSidecar
{
    internal class DataChannelProcessor
    {
        private readonly PeerManager _peerManager;
        private readonly IVoiceLogger _log;
        private readonly Func<string, bool> _sendString;

        public DataChannelProcessor(PeerManager peerManager, IVoiceLogger log, Func<string, bool> sendString)
        {
            _peerManager = peerManager ?? throw new ArgumentNullException(nameof(peerManager));
            _log = log;
            _sendString = sendString;
        }

        // Send helpers delegated from VoiceSession
        public bool TrySend(string str)
        {
            try { return _sendString?.Invoke(str) ?? false; }
            catch (Exception ex) { try { _log.Debug($"TrySend failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendJoin(bool primary = true)
        {
            try
            {
                var jw = new JsonWriter();
                jw.WriteObjectStart();
                jw.WritePropertyName("j"); jw.WriteObjectStart();
                jw.WritePropertyName("p"); jw.Write(primary);
                jw.WriteObjectEnd();
                jw.WriteObjectEnd();
                return TrySend(jw.ToString());
            }
            catch (Exception ex) { try { _log.Debug($"SendJoin failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendLeave()
        {
            try { return TrySend("{\"l\":true}"); }
            catch (Exception ex) { try { _log.Debug($"SendLeave failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendPing() => TrySend("{\"ping\":true}");
        public bool SendPong() => TrySend("{\"pong\":true}");

        public bool SetPeerMute(UUID peerId, bool mute)
        {
            try { return TrySend("{\"m\": {\"" + peerId + "\": " + (mute ? "true" : "false") + "}}"); }
            catch (Exception ex) { try { _log.Debug($"SetPeerMute failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SetPeerGain(UUID peerId, int gain)
        {
            try { return TrySend("{\"ug\": {\"" + peerId + "\": " + gain + "}}"); }
            catch (Exception ex) { try { _log.Debug($"SetPeerGain failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendPosition(Vector3 globalPos, Quaternion heading)
        {
            try
            {
                int posX = (int)Math.Round(globalPos.X * 100);
                int posY = (int)Math.Round(globalPos.Y * 100);
                int posZ = (int)Math.Round(globalPos.Z * 100);

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
                return TrySend(jw.ToString());
            }
            catch (Exception ex) { try { _log.Debug($"SendPosition failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendAvatarArray(List<UUID> avatars)
        {
            try
            {
                var jw = new JsonWriter(); jw.WriteObjectStart(); jw.WritePropertyName("av"); jw.WriteArrayStart();
                if (avatars != null) foreach (var id in avatars) jw.Write(id.ToString());
                jw.WriteArrayEnd(); jw.WriteObjectEnd();
                return TrySend(jw.ToString());
            }
            catch (Exception ex) { try { _log.Debug($"SendAvatarArray failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendAvatarMap(IEnumerable<UUID> avatars)
        {
            try
            {
                var jw = new JsonWriter(); jw.WriteObjectStart(); jw.WritePropertyName("a"); jw.WriteObjectStart();
                if (avatars != null) foreach (var id in avatars) { jw.WritePropertyName(id.ToString()); jw.WriteObjectStart(); jw.WriteObjectEnd(); }
                jw.WriteObjectEnd(); jw.WriteObjectEnd();
                return TrySend(jw.ToString());
            }
            catch (Exception ex) { try { _log.Debug($"SendAvatarMap failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendMuteMap(Dictionary<UUID, bool> muteMap)
        {
            try
            {
                var jw = new JsonWriter(); jw.WriteObjectStart(); jw.WritePropertyName("m"); jw.WriteObjectStart();
                if (muteMap != null) foreach (var kv in muteMap) { jw.WritePropertyName(kv.Key.ToString()); jw.Write(kv.Value); }
                jw.WriteObjectEnd(); jw.WriteObjectEnd();
                return TrySend(jw.ToString());
            }
            catch (Exception ex) { try { _log.Debug($"SendMuteMap failed: {ex.Message}"); } catch { } return false; }
        }

        public bool SendGainMap(Dictionary<UUID, int> gainMap)
        {
            try
            {
                var jw = new JsonWriter(); jw.WriteObjectStart(); jw.WritePropertyName("ug"); jw.WriteObjectStart();
                if (gainMap != null) foreach (var kv in gainMap) { jw.WritePropertyName(kv.Key.ToString()); jw.Write(kv.Value); }
                jw.WriteObjectEnd(); jw.WriteObjectEnd();
                return TrySend(jw.ToString());
            }
            catch (Exception ex) { try { _log.Debug($"SendGainMap failed: {ex.Message}"); } catch { } return false; }
        }

        public void ProcessMessage(string msg, UUID sessionId)
        {
            if (string.IsNullOrWhiteSpace(msg)) return;

            try
            {
                JsonData root = null;
                try
                {
                    root = JsonMapper.ToObject(msg);
                }
                catch (Exception litEx)
                {
                    try { _log.Debug($"LitJson parsing failed: {litEx.Message}"); } catch { }
                }

                if (root != null && root.IsObject)
                {
                    try { _peerManager.ProcessLitJson(root, _sendString, sessionId); } catch (Exception ex) { try { _log.Error($"PeerManager.ProcessLitJson failed: {ex.Message}"); } catch { } }
                    return;
                }

                // Fallback to OSD path
                try
                {
                    var osd = OSDParser.DeserializeJson(msg);
                    if (osd is OSDMap map)
                    {
                        try { _peerManager.ProcessOSDMap(map, _sendString, sessionId); } catch (Exception ex) { try { _log.Error($"PeerManager.ProcessOSDMap failed: {ex.Message}"); } catch { } }
                        return;
                    }

                    try { _log.Debug($"Data channel payload is not an OSDMap (type={osd?.GetType().Name}). Raw: {msg}"); } catch { }
                }
                catch (Exception ex)
                {
                    try { _log.Error($"Failed to deserialize fallback OSD JSON: {ex.Message}. Raw: {msg}"); } catch { }
                }
            }
            catch (Exception ex)
            {
                try { _log.Error($"DataChannelProcessor failed to process message: {ex.Message}. Raw: {msg}"); } catch { }
            }
        }
    }
}
