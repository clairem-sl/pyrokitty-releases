using System.Collections;
using LitJson;
using OpenMetaverse;

namespace VoiceSidecar.Tests;

/// <summary>
/// Stub logger that captures nothing — just satisfies the IVoiceLogger interface.
/// </summary>
internal class NullLogger : IVoiceLogger
{
    public void Info(string message) { }
    public void Warn(string message) { }
    public void Debug(string message) { }
    public void Error(string message) { }
}

public class DataChannelProcessorTests
{
    private readonly List<string> _sent = new();
    private readonly DataChannelProcessor _proc;

    public DataChannelProcessorTests()
    {
        // PeerManager requires Sdl3Audio, but send methods don't touch it.
        // Pass null — safe because we only test the Send* surface.
        var peerMgr = new PeerManager(null, new NullLogger());
        _proc = new DataChannelProcessor(peerMgr, new NullLogger(), str =>
        {
            _sent.Add(str);
            return true;
        });
    }

    /// <summary>Check if a JsonData object contains a key (LitJson uses IDictionary).</summary>
    private static bool HasKey(JsonData obj, string key) => ((IDictionary)obj).Contains(key);

    // ── SendJoin ────────────────────────────────────────────────────

    [Fact]
    public void SendJoin_Primary_ProducesValidJson()
    {
        _proc.SendJoin(primary: true);

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "j"));
        Assert.True(((JsonData)root["j"])["p"].IsBoolean);
        Assert.True((bool)((JsonData)root["j"])["p"]);
    }

    [Fact]
    public void SendJoin_NotPrimary_SetsFalse()
    {
        _proc.SendJoin(primary: false);

        var root = JsonMapper.ToObject(_sent[0]);
        Assert.False((bool)((JsonData)root["j"])["p"]);
    }

    // ── SendLeave ───────────────────────────────────────────────────

    [Fact]
    public void SendLeave_ProducesCorrectJson()
    {
        _proc.SendLeave();

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "l"));
        Assert.True((bool)root["l"]);
    }

    // ── SendPing / SendPong ─────────────────────────────────────────

    [Fact]
    public void SendPing_ProducesCorrectJson()
    {
        _proc.SendPing();

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "ping"));
        Assert.True((bool)root["ping"]);
    }

    [Fact]
    public void SendPong_ProducesCorrectJson()
    {
        _proc.SendPong();

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "pong"));
        Assert.True((bool)root["pong"]);
    }

    // ── SetPeerMute ─────────────────────────────────────────────────

    [Fact]
    public void SetPeerMute_True_ProducesCorrectJson()
    {
        var peerId = UUID.Random();
        _proc.SetPeerMute(peerId, true);

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "m"));
        var muteMap = root["m"];
        Assert.True(HasKey(muteMap, peerId.ToString()));
        Assert.True((bool)muteMap[peerId.ToString()]);
    }

    [Fact]
    public void SetPeerMute_False_ProducesCorrectJson()
    {
        var peerId = UUID.Random();
        _proc.SetPeerMute(peerId, false);

        var root = JsonMapper.ToObject(_sent[0]);
        Assert.False((bool)root["m"][peerId.ToString()]);
    }

    // ── SetPeerGain ─────────────────────────────────────────────────

    [Fact]
    public void SetPeerGain_ProducesCorrectJson()
    {
        var peerId = UUID.Random();
        _proc.SetPeerGain(peerId, 75);

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "ug"));
        Assert.Equal(75, (int)root["ug"][peerId.ToString()]);
    }

    [Fact]
    public void SetPeerGain_ZeroValue()
    {
        var peerId = UUID.Random();
        _proc.SetPeerGain(peerId, 0);

        var root = JsonMapper.ToObject(_sent[0]);
        Assert.Equal(0, (int)root["ug"][peerId.ToString()]);
    }

    // ── SendPosition ────────────────────────────────────────────────

    [Fact]
    public void SendPosition_EncodesCoordinatesTimesCent()
    {
        var pos = new Vector3(128.5f, 64.25f, 30.0f);
        var heading = new Quaternion(0.1f, 0.2f, 0.3f, 0.9f);
        _proc.SendPosition(pos, heading);

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);

        // Position multiplied by 100 and rounded
        var sp = root["sp"];
        Assert.Equal(12850, (int)sp["x"]);
        Assert.Equal(6425, (int)sp["y"]);
        Assert.Equal(3000, (int)sp["z"]);

        // Heading quaternion multiplied by 100 and rounded
        var sh = root["sh"];
        Assert.Equal(10, (int)sh["x"]);
        Assert.Equal(20, (int)sh["y"]);
        Assert.Equal(30, (int)sh["z"]);
        Assert.Equal(90, (int)sh["w"]);
    }

    [Fact]
    public void SendPosition_LocalAndSpatialPositionMatch()
    {
        var pos = new Vector3(10, 20, 30);
        var heading = Quaternion.Identity;
        _proc.SendPosition(pos, heading);

        var root = JsonMapper.ToObject(_sent[0]);

        // sp and lp should have the same values
        Assert.Equal((int)root["sp"]["x"], (int)root["lp"]["x"]);
        Assert.Equal((int)root["sp"]["y"], (int)root["lp"]["y"]);
        Assert.Equal((int)root["sp"]["z"], (int)root["lp"]["z"]);

        // sh and lh should have the same values
        Assert.Equal((int)root["sh"]["x"], (int)root["lh"]["x"]);
        Assert.Equal((int)root["sh"]["y"], (int)root["lh"]["y"]);
        Assert.Equal((int)root["sh"]["z"], (int)root["lh"]["z"]);
        Assert.Equal((int)root["sh"]["w"], (int)root["lh"]["w"]);
    }

    [Fact]
    public void SendPosition_OriginProducesZeros()
    {
        _proc.SendPosition(Vector3.Zero, Quaternion.Identity);

        var root = JsonMapper.ToObject(_sent[0]);
        Assert.Equal(0, (int)root["sp"]["x"]);
        Assert.Equal(0, (int)root["sp"]["y"]);
        Assert.Equal(0, (int)root["sp"]["z"]);
    }

    // ── SendAvatarArray ─────────────────────────────────────────────

    [Fact]
    public void SendAvatarArray_ProducesJsonArray()
    {
        var id1 = UUID.Random();
        var id2 = UUID.Random();
        _proc.SendAvatarArray(new List<UUID> { id1, id2 });

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "av"));
        var arr = root["av"];
        Assert.True(arr.IsArray);
        Assert.Equal(2, arr.Count);
        Assert.Equal(id1.ToString(), (string)arr[0]);
        Assert.Equal(id2.ToString(), (string)arr[1]);
    }

    [Fact]
    public void SendAvatarArray_EmptyList_ProducesEmptyArray()
    {
        _proc.SendAvatarArray(new List<UUID>());

        var root = JsonMapper.ToObject(_sent[0]);
        Assert.Equal(0, root["av"].Count);
    }

    // ── SendAvatarMap ───────────────────────────────────────────────

    [Fact]
    public void SendAvatarMap_ProducesJsonObject()
    {
        var id1 = UUID.Random();
        var id2 = UUID.Random();
        _proc.SendAvatarMap(new List<UUID> { id1, id2 });

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "a"));
        var map = root["a"];
        Assert.True(map.IsObject);
        Assert.True(HasKey(map, id1.ToString()));
        Assert.True(HasKey(map, id2.ToString()));
    }

    // ── SendMuteMap ─────────────────────────────────────────────────

    [Fact]
    public void SendMuteMap_ProducesCorrectJson()
    {
        var id1 = UUID.Random();
        var id2 = UUID.Random();
        var muteMap = new Dictionary<UUID, bool>
        {
            { id1, true },
            { id2, false }
        };
        _proc.SendMuteMap(muteMap);

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "m"));
        Assert.True((bool)root["m"][id1.ToString()]);
        Assert.False((bool)root["m"][id2.ToString()]);
    }

    // ── SendGainMap ─────────────────────────────────────────────────

    [Fact]
    public void SendGainMap_ProducesCorrectJson()
    {
        var id1 = UUID.Random();
        var id2 = UUID.Random();
        var gainMap = new Dictionary<UUID, int>
        {
            { id1, 100 },
            { id2, 50 }
        };
        _proc.SendGainMap(gainMap);

        Assert.Single(_sent);
        var root = JsonMapper.ToObject(_sent[0]);
        Assert.True(HasKey(root, "ug"));
        Assert.Equal(100, (int)root["ug"][id1.ToString()]);
        Assert.Equal(50, (int)root["ug"][id2.ToString()]);
    }

    // ── TrySend failure ─────────────────────────────────────────────

    [Fact]
    public void TrySend_ReturnsFalse_WhenDelegateReturnsFalse()
    {
        var peerMgr = new PeerManager(null, new NullLogger());
        var proc = new DataChannelProcessor(peerMgr, new NullLogger(), str => false);

        bool result = proc.SendJoin();
        Assert.False(result);
    }
}
