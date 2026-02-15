using OpenMetaverse;

namespace VoiceSidecar
{
    /// <summary>
    /// IVoiceContext implementation backed by state received from Electron over JSON IPC.
    /// Electron sets caps, position, rotation etc. via JSON commands on stdin.
    /// </summary>
    public class JsonIpcContext : IVoiceContext
    {
        private readonly Dictionary<string, Uri> _caps = new();
        private readonly HttpClient _httpClient = new();
        private readonly object _lock = new();

        public Vector3 AgentPosition { get; set; } = Vector3.Zero;
        public Quaternion AgentRotation { get; set; } = Quaternion.Identity;
        public string AgentId { get; set; } = string.Empty;
        public string SessionId { get; set; } = string.Empty;
        public string RegionName { get; set; } = string.Empty;
        public int ParcelLocalId { get; set; } = -1;
        public bool Connected { get; set; } = false;

        public void SetCaps(Dictionary<string, string> caps)
        {
            lock (_lock)
            {
                _caps.Clear();
                foreach (var kv in caps)
                {
                    if (Uri.TryCreate(kv.Value, UriKind.Absolute, out var uri))
                    {
                        _caps[kv.Key] = uri;
                    }
                }
                Connected = _caps.Count > 0;
            }
        }

        public Uri GetCapability(string name)
        {
            lock (_lock)
            {
                return _caps.TryGetValue(name, out var uri) ? uri : null;
            }
        }

        public async Task<byte[]> PostCapAsync(Uri capUrl, byte[] body, CancellationToken ct = default)
        {
            var content = new ByteArrayContent(body);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/llsd+xml");

            var response = await _httpClient.PostAsync(capUrl, content, ct).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsByteArrayAsync(ct).ConfigureAwait(false);
        }

        public void Disconnect()
        {
            lock (_lock)
            {
                _caps.Clear();
                Connected = false;
            }
        }
    }
}
