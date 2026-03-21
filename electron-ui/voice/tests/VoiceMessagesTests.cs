using OpenMetaverse.StructuredData;

namespace VoiceSidecar.Tests;

public class VoiceMessagesTests
{
    // ── LocalVoiceProvisionRequest ──────────────────────────────────

    [Fact]
    public void LocalProvision_Serialize_ContainsJsepOffer()
    {
        var req = new LocalVoiceProvisionRequest("v=0\r\no=- ...", parcelId: -1);
        OSDMap map = req.Serialize();

        Assert.True(map.ContainsKey("jsep"));
        var jsep = (OSDMap)map["jsep"];
        Assert.Equal("offer", jsep["type"].AsString());
        Assert.Equal("v=0\r\no=- ...", jsep["sdp"].AsString());
    }

    [Fact]
    public void LocalProvision_Serialize_ChannelTypeIsLocal()
    {
        var req = new LocalVoiceProvisionRequest("sdp-data", parcelId: -1);
        OSDMap map = req.Serialize();

        Assert.Equal("local", map["channel_type"].AsString());
    }

    [Fact]
    public void LocalProvision_Serialize_VoiceServerTypeIsWebrtc()
    {
        var req = new LocalVoiceProvisionRequest("sdp-data", parcelId: -1);
        OSDMap map = req.Serialize();

        Assert.Equal("webrtc", map["voice_server_type"].AsString());
    }

    [Fact]
    public void LocalProvision_Serialize_IncludesParcelId_WhenPositive()
    {
        var req = new LocalVoiceProvisionRequest("sdp", parcelId: 42);
        OSDMap map = req.Serialize();

        Assert.True(map.ContainsKey("parcel_local_id"));
        Assert.Equal(42, map["parcel_local_id"].AsInteger());
    }

    [Fact]
    public void LocalProvision_Serialize_OmitsParcelId_WhenNegative()
    {
        var req = new LocalVoiceProvisionRequest("sdp", parcelId: -1);
        OSDMap map = req.Serialize();

        Assert.False(map.ContainsKey("parcel_local_id"));
    }

    [Fact]
    public void LocalProvision_Serialize_IncludesParcelId_WhenZero()
    {
        var req = new LocalVoiceProvisionRequest("sdp", parcelId: 0);
        OSDMap map = req.Serialize();

        Assert.True(map.ContainsKey("parcel_local_id"));
        Assert.Equal(0, map["parcel_local_id"].AsInteger());
    }

    // ── MultiAgentVoiceProvisionRequest ─────────────────────────────

    [Fact]
    public void MultiAgent_Serialize_ContainsJsepOffer()
    {
        var req = new MultiAgentVoiceProvisionRequest("sdp-data")
        {
            ChannelId = "chan-123",
            ChannelCredentials = "cred-abc"
        };
        OSDMap map = req.Serialize();

        Assert.True(map.ContainsKey("jsep"));
        var jsep = (OSDMap)map["jsep"];
        Assert.Equal("offer", jsep["type"].AsString());
        Assert.Equal("sdp-data", jsep["sdp"].AsString());
    }

    [Fact]
    public void MultiAgent_Serialize_ChannelTypeIsMultiagent()
    {
        var req = new MultiAgentVoiceProvisionRequest("sdp")
        {
            ChannelId = "c",
            ChannelCredentials = "k"
        };
        OSDMap map = req.Serialize();

        Assert.Equal("multiagent", map["channel_type"].AsString());
    }

    [Fact]
    public void MultiAgent_Serialize_IncludesChannelAndCredentials()
    {
        var req = new MultiAgentVoiceProvisionRequest("sdp")
        {
            ChannelId = "my-channel",
            ChannelCredentials = "secret-token"
        };
        OSDMap map = req.Serialize();

        Assert.Equal("my-channel", map["channel"].AsString());
        Assert.Equal("secret-token", map["credentials"].AsString());
    }

    [Fact]
    public void MultiAgent_Serialize_VoiceServerTypeIsWebrtc()
    {
        var req = new MultiAgentVoiceProvisionRequest("sdp")
        {
            ChannelId = "c",
            ChannelCredentials = "k"
        };
        OSDMap map = req.Serialize();

        Assert.Equal("webrtc", map["voice_server_type"].AsString());
    }
}
