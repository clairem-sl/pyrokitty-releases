using OpenMetaverse.StructuredData;

namespace VoiceSidecar
{
    internal class LocalVoiceProvisionRequest
    {
        public string Sdp;
        public int ParcelId = -1;

        public LocalVoiceProvisionRequest(string sdp, int parcelId)
        {
            Sdp = sdp;
            ParcelId = parcelId;
        }

        public OSDMap Serialize()
        {
            var map = new OSDMap(1);
            var jsep = new OSDMap(5)
            {
                { "type", "offer" },
                { "sdp", Sdp },
            };
            map.Add("jsep", jsep);
            if (ParcelId > -1)
            {
                map["parcel_local_id"] = ParcelId;
            }
            map.Add("channel_type", "local");
            map.Add("voice_server_type", "webrtc");

            return map;
        }
    }

    internal class MultiAgentVoiceProvisionRequest
    {
        public string Sdp;
        public string ChannelId;
        public string ChannelCredentials;

        public MultiAgentVoiceProvisionRequest(string sdp)
        {
            Sdp = sdp;
        }

        public OSDMap Serialize()
        {
            var map = new OSDMap(1);
            var jsep = new OSDMap(5)
            {
                { "type", "offer" },
                { "sdp", Sdp },
            };
            map.Add("jsep", jsep);
            map.Add("channel", ChannelId);
            map.Add("credentials", ChannelCredentials);
            map.Add("channel_type", "multiagent");
            map.Add("voice_server_type", "webrtc");

            return map;
        }
    }
}
