using SIPSorcery.Media;
using SIPSorceryMedia.Abstractions;
using System;
using System.Collections.Generic;
using Concentus;
using Concentus.Enums;

namespace VoiceSidecar
{
    internal class OpusAudioEncoder : IAudioEncoder
    {
        public static readonly AudioFormat MEDIA_FORMAT_OPUS = new AudioFormat(111,
            "opus", SAMPLE_RATE, SAMPLE_RATE, 2,
            "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxplaybackrate=48000;sprop-maxplaybackrate=48000;sprop-maxcapturerate=48000");

        private readonly AudioEncoder _audioEncoder;

        private const int FRAME_SIZE_MILLISECONDS = 20;
        private const int MAX_DECODED_FRAME_SIZE_MULT = 6;
        private const int MAX_PACKET_SIZE = 4000;
        private const int MAX_FRAME_SIZE = MAX_DECODED_FRAME_SIZE_MULT * 960;
        private const int SAMPLE_RATE = 48000;

        private int _channels = 1;
        private short[] _shortBuffer;
        private byte[] _byteBuffer;

        private IOpusEncoder _opusEncoder;
        private IOpusDecoder _opusDecoder;

        public List<AudioFormat> SupportedFormats { get; }

        public OpusAudioEncoder()
        {
            _audioEncoder = new AudioEncoder();
            SupportedFormats = new List<AudioFormat> { MEDIA_FORMAT_OPUS };
            SupportedFormats.AddRange(_audioEncoder.SupportedFormats);
        }

        public short[] DecodeAudio(byte[] encodedSample, AudioFormat format)
        {
            if (format.FormatName != "opus") { return _audioEncoder.DecodeAudio(encodedSample, format); }

            if (_opusDecoder == null)
            {
                _opusDecoder = OpusCodecFactory.CreateDecoder(SAMPLE_RATE, _channels);
                _shortBuffer = new short[MAX_FRAME_SIZE * _channels];
            }

            try
            {
                var numSamplesDecoded = _opusDecoder.Decode(
                        encodedSample.AsSpan(), _shortBuffer.AsSpan(), GetFrameSize());

                if (numSamplesDecoded >= 1)
                {
                    var buffer = new short[numSamplesDecoded];
                    Array.Copy(_shortBuffer, 0, buffer, 0, numSamplesDecoded);
                    return buffer;
                }
            }
            catch { }
            return Array.Empty<short>();
        }

        public byte[] EncodeAudio(short[] in_pcm, AudioFormat format)
        {
            if (format.FormatName != "opus") { return _audioEncoder.EncodeAudio(in_pcm, format); }

            if (_opusEncoder == null)
            {
                _opusEncoder = OpusCodecFactory.CreateEncoder(SAMPLE_RATE, _channels, OpusApplication.OPUS_APPLICATION_VOIP);
                _opusEncoder.ForceMode = OpusMode.MODE_AUTO;
                _byteBuffer = new byte[MAX_PACKET_SIZE];
            }

            try
            {
                var size = _opusEncoder.Encode(
                    in_pcm.AsSpan(), GetFrameSize(), _byteBuffer.AsSpan(), MAX_PACKET_SIZE);

                if (size > 1)
                {
                    var result = new byte[size];
                    Array.Copy(_byteBuffer, 0, result, 0, size);
                    return result;
                }
            }
            catch { }
            return Array.Empty<byte>();
        }

        public int GetFrameSize()
        {
            return 960;
        }
    }
}
