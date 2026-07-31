"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { Send, Calendar as CalendarIcon, LogOut, Bot, User, Sparkles, Mic, Square } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [messages, setMessages] = useState<{ role: "user" | "agent", content: string }[]>([
    { role: "agent", content: "Hello! I am your AI scheduling assistant. How can I help you manage your calendar today?" }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const messagesRef = useRef<{ role: string, content: string }[]>([]);

  // Silence detection refs
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef<boolean>(false);

  // Audio playback queue refs
  const textQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    messagesRef.current = messages;
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [messages, refreshKey]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      isRecordingRef.current = true;

      // Silence Detection using Word Activity
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognitionRef.current = recognition;

        const resetSilenceTimeout = () => {
          if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = setTimeout(() => {
            if (isRecordingRef.current) stopRecording();
          }, 3000); // 3 seconds of silence after the last spoken word
        };

        recognition.onstart = () => resetSilenceTimeout();
        recognition.onresult = () => resetSilenceTimeout();
        
        try {
          recognition.start();
        } catch (e) {
          console.error("Speech recognition failed to start", e);
        }
      } else {
        // Fallback: Just timeout after 5 seconds if word detection isn't supported
        silenceTimeoutRef.current = setTimeout(() => {
          if (isRecordingRef.current) stopRecording();
        }, 5000);
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processVoiceInput(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access is required for voice input.");
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }

    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const processVoiceInput = async (audioBlob: Blob) => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");

      const sttRes = await fetch("/api/stt", {
        method: "POST",
        body: formData,
      });

      const sttData = await sttRes.json();
      if (sttData.text) {
        await executeMessageFlow(sttData.text);
      } else {
        throw new Error(sttData.error || "Failed to transcribe audio");
      }
    } catch (err) {
      console.error("STT error:", err);
      setMessages((prev) => [...prev, { role: "agent", content: "Sorry, I couldn't understand the audio." }]);
      setIsLoading(false);
    }
  };

  const playTTS = (text: string) => {
    if (!text) return;
    const cleanText = text.replace(/[*#]/g, ""); // strip basic markdown for speech
    textQueueRef.current.push(cleanText);
    processTextQueue();
  };

  const processTextQueue = async () => {
    if (isPlayingRef.current || textQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    setIsPlaying(true);
    const text = textQueueRef.current.shift()!;

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);

        audio.play().catch(e => {
          console.error("Error playing audio:", e);
          isPlayingRef.current = false;
          setIsPlaying(false);
          processTextQueue();
        });

        audio.onended = () => {
          isPlayingRef.current = false;
          setIsPlaying(false);
          
          if (textQueueRef.current.length > 0) {
            processTextQueue();
          } else {
            // Auto-resume recording when AI finishes speaking for hands-free mode
            startRecording();
          }
        };
      } else {
        isPlayingRef.current = false;
        setIsPlaying(false);
        processTextQueue();
      }
    } catch (err) {
      console.error("TTS error:", err);
      isPlayingRef.current = false;
      setIsPlaying(false);
      processTextQueue();
    }
  };

  const executeMessageFlow = async (text: string) => {
    const newUserMsg = { role: "user" as const, content: text };
    const newMsgs = [...messagesRef.current, newUserMsg];

    // Update UI
    setMessages(newMsgs);

    // Execute API call exactly once
    fetchChatResponse(newMsgs);
  };

  const fetchChatResponse = async (history: any[]) => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      const data = await response.json();
      const reply = data.reply || data.error || "Sorry, I encountered an unexpected error.";
      setMessages((prev) => [...prev, { role: "agent", content: reply }]);

      setRefreshKey(Date.now());
      playTTS(reply);

    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [...prev, { role: "agent", content: "Sorry, I encountered an error while processing your request." }]);
    } finally {
      setIsLoading(false);
    }
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    await executeMessageFlow(userMessage);
  };

  if (status === "loading") {
    return <div className="flex h-screen items-center justify-center bg-[#f5f5f7]"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1d1d1f] border-t-transparent"></div></div>;
  }

  if (!session) return null;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f7] font-sans antialiased text-[#1d1d1f] overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#d2d2d7]/40 bg-[#f5f5f7]/80 backdrop-blur-md px-8 z-20 relative">
        <div className="flex items-center gap-2 font-semibold text-lg text-[#1d1d1f] tracking-tight">
          <CalendarIcon className="h-5 w-5 text-[#1d1d1f]" />
          Calendy<span className="text-[#86868b]">AI</span>
        </div>
        <div className="flex items-center gap-6 text-sm font-medium text-[#1d1d1f]">
          <div className="hidden sm:flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500"></div>
            {session.user?.email}
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 text-[#86868b] hover:text-[#1d1d1f] transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full relative bg-[#f5f5f7] p-16 sm:p-12">
        {/* Floating Card Calendar */}
        <div className="w-full h-full bg-white rounded-3xl shadow-sm border border-[#d2d2d7]/70 overflow-hidden relative z-0">
          <iframe
            key={refreshKey}
            src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(session.user?.email || "")}&mode=WEEK&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=0&wkst=1&bgcolor=%23ffffff`}
            style={{ borderWidth: 0 }}
            width="100%"
            height="100%"
            frameBorder="0"
            scrolling="yes"
            className="w-full h-full"
          ></iframe>
        </div>

        {/* Floating Voice Controls */}
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 w-full px-4 sm:px-0">
          
          {/* Main Voice Dock */}
          <div className="flex items-center gap-4 px-3 py-3 rounded-full backdrop-blur-2xl bg-white/65 border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.12)] transition-all duration-500 ease-out">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading && !isPlaying}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all shadow-sm ${isRecording
                  ? "bg-red-500 text-white animate-pulse shadow-md shadow-red-500/30"
                  : isPlaying
                    ? "bg-[#0071e3] text-white shadow-md shadow-[#0071e3]/30"
                    : "bg-white text-[#1d1d1f] border border-[#d2d2d7]/50 hover:bg-[#f5f5f7]"
                } disabled:opacity-50`}
            >
              {isRecording ? (
                <Square className="h-4 w-4 fill-current" />
              ) : isPlaying ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>

            {isPlaying && (
              <div className="flex items-center justify-center gap-[3px] h-6 w-8 shrink-0 pr-3">
                <div className="w-[3px] bg-[#0071e3] rounded-full h-full" style={{ animation: 'waveform 1s ease-in-out infinite 0.1s' }}></div>
                <div className="w-[3px] bg-[#0071e3] rounded-full h-full" style={{ animation: 'waveform 1.2s ease-in-out infinite 0.3s' }}></div>
                <div className="w-[3px] bg-[#0071e3] rounded-full h-full" style={{ animation: 'waveform 0.8s ease-in-out infinite 0.0s' }}></div>
                <div className="w-[3px] bg-[#0071e3] rounded-full h-full" style={{ animation: 'waveform 1.1s ease-in-out infinite 0.4s' }}></div>
                <div className="w-[3px] bg-[#0071e3] rounded-full h-full" style={{ animation: 'waveform 0.9s ease-in-out infinite 0.2s' }}></div>
              </div>
            )}
          </div>

          {/* Secondary Transcription Tab */}
          <div className="flex items-center px-5 py-2.5 rounded-2xl backdrop-blur-xl bg-white/50 border border-white/40 shadow-sm transition-all duration-500 min-w-[280px] max-w-md w-auto">
            <form onSubmit={sendMessage} className="flex flex-col flex-1 overflow-hidden min-w-0 text-center">
              <span className="text-[9px] font-bold tracking-wider uppercase text-[#86868b] mb-0.5">
                {isRecording ? "Listening..." : isPlaying ? "Speaking..." : isLoading ? "Thinking..." : "Assistant"}
              </span>
              
              {isRecording || isPlaying || isLoading ? (
                <div className="text-[13px] text-[#1d1d1f] font-medium truncate w-full animate-fade-in">
                  {messages.length > 0 ? messages[messages.length - 1].content : "Processing..."}
                </div>
              ) : (
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Tap mic or type here..."
                  disabled={isRecording || isPlaying}
                  className="w-full bg-transparent border-none p-0 m-0 text-[13px] text-center text-[#1d1d1f] font-medium placeholder:text-[#86868b] placeholder:font-normal focus:ring-0 focus:outline-none"
                />
              )}
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
