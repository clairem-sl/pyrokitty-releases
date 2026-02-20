namespace VoiceSidecar
{
    public class VoiceException : Exception
    {
        public VoiceException() { }
        public VoiceException(string message) : base(message) { }
        public VoiceException(string message, Exception innerException) : base(message, innerException) { }
    }
}
