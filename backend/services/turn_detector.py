import numpy as np

class TurnDetectionHandler:
    def __init__(self, silence_threshold_db: float = -45.0, min_speech_ms: int = 120):
        self.silence_threshold_db = silence_threshold_db
        self.min_speech_ms = min_speech_ms
        self.speech_buffer_ms = 0
        self.silence_buffer_ms = 0
        self.is_speaking = False

    def process_audio_frame(self, pcm_chunk: bytes) -> bool:
        """Processes 20ms PCM audio frame (16kHz 16-bit mono = 640 bytes).
        Returns True if speech onset is detected (triggering immediate TTS Interruption signal).
        """
        if len(pcm_chunk) < 2:
            return False

        audio_data = np.frombuffer(pcm_chunk, dtype=np.int16)
        # Calculate Root Mean Square (RMS) energy in decibels
        rms = np.sqrt(np.mean(audio_data.astype(np.float32)**2))
        db = 20 * np.log10(rms) if rms > 0 else -100.0

        if db > self.silence_threshold_db:
            self.speech_buffer_ms += 20
            self.silence_buffer_ms = 0
            if self.speech_buffer_ms >= self.min_speech_ms and not self.is_speaking:
                self.is_speaking = True
                return True  # Trigger immediate TTS Interruption signal!
        else:
            self.speech_buffer_ms = max(0, self.speech_buffer_ms - 20)
            self.silence_buffer_ms += 20
            if self.speech_buffer_ms == 0:
                self.is_speaking = False

        return False

    def get_silence_duration_ms(self) -> int:
        return self.silence_buffer_ms

    def reset(self):
        self.speech_buffer_ms = 0
        self.silence_buffer_ms = 0
        self.is_speaking = False
