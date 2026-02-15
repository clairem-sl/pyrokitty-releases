using OpenMetaverse;

namespace VoiceSidecar
{
    public interface IVoiceContext
    {
        /// <summary>
        /// Look up a capability URL by name (ProvisionVoiceAccountRequest, VoiceSignalingRequest, ParcelVoiceInfoRequest).
        /// Returns null if not available.
        /// </summary>
        Uri GetCapability(string name);

        /// <summary>Current agent global position (updated via IPC).</summary>
        Vector3 AgentPosition { get; }

        /// <summary>Current agent rotation (updated via IPC).</summary>
        Quaternion AgentRotation { get; }

        /// <summary>Agent UUID string.</summary>
        string AgentId { get; }

        /// <summary>Current session UUID string.</summary>
        string SessionId { get; }

        /// <summary>Current region name.</summary>
        string RegionName { get; }

        /// <summary>Current parcel local ID.</summary>
        int ParcelLocalId { get; }

        /// <summary>Whether the context is connected and has valid cap URLs.</summary>
        bool Connected { get; }

        /// <summary>
        /// POST OSD XML to a capability URL and return deserialized response.
        /// The sidecar implements this using HttpClient.
        /// </summary>
        Task<byte[]> PostCapAsync(Uri capUrl, byte[] body, CancellationToken ct = default);
    }
}
