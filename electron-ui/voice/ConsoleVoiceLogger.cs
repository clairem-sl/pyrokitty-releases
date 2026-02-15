using Microsoft.Extensions.Logging;

namespace VoiceSidecar
{
    internal class ConsoleVoiceLogger : IVoiceLogger
    {
        private const string Prefix = "[Voice] ";

        public void Info(string message) => Console.Error.WriteLine(Prefix + "INFO  " + message);
        public void Warn(string message) => Console.Error.WriteLine(Prefix + "WARN  " + message);
        public void Debug(string message) => Console.Error.WriteLine(Prefix + "DEBUG " + message);
        public void Error(string message) => Console.Error.WriteLine(Prefix + "ERROR " + message);
    }

    // Adapter so SIPSorcery's ILoggerFactory can route through our IVoiceLogger
    internal class VoiceLoggerProvider : ILoggerProvider
    {
        private readonly IVoiceLogger _voiceLogger;
        public VoiceLoggerProvider(IVoiceLogger voiceLogger) => _voiceLogger = voiceLogger;
        public ILogger CreateLogger(string categoryName) => new VoiceLoggerAdapter(_voiceLogger, categoryName);
        public void Dispose() { }
    }

    internal class VoiceLoggerAdapter : ILogger
    {
        private readonly IVoiceLogger _log;
        private readonly string _category;

        public VoiceLoggerAdapter(IVoiceLogger log, string category)
        {
            _log = log;
            _category = category;
        }

        public IDisposable BeginScope<TState>(TState state) => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception exception, Func<TState, Exception, string> formatter)
        {
            try
            {
                var msg = $"[{_category}] {formatter(state, exception)}";
                switch (logLevel)
                {
                    case LogLevel.Error:
                    case LogLevel.Critical:
                        _log.Error(msg);
                        break;
                    case LogLevel.Warning:
                        _log.Warn(msg);
                        break;
                    case LogLevel.Information:
                        _log.Info(msg);
                        break;
                    default:
                        _log.Debug(msg);
                        break;
                }
                if (exception != null) _log.Error(exception.ToString());
            }
            catch { }
        }
    }
}
