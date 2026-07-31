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
  const messagesRef = useRef<{ role: "user" | "agent", content: string }[]>([]);

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
    return (
      <div className="flex h-screen items-center justify-center bg-[#F0F0F0]">
        <div className="h-12 w-12 animate-spin rounded-none border-4 border-[#121212] border-t-[#D02020]"></div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="flex h-screen flex-col bg-[#F0F0F0] font-sans antialiased text-[#121212] overflow-hidden">
      {/* Bauhaus Header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b-4 border-[#121212] bg-white px-8 z-20 relative shadow-[0_4px_0px_0px_#121212]">
        <div className="flex items-center gap-3 font-black text-xl tracking-tighter uppercase text-[#121212]">
          {/* Bauhaus Geometric Composition Logo */}
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-4 rounded-full bg-[#D02020] border-2 border-[#121212]"></div>
            <div className="h-4 w-4 rounded-none bg-[#1040C0] border-2 border-[#121212]"></div>
            <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-[#F0C020]"></div>
          </div>
          CALENDY<span className="text-[#D02020]">.AI</span>
        </div>

        <div className="flex items-center gap-6 text-xs font-bold uppercase tracking-wider text-[#121212]">
          <div className="hidden sm:flex items-center gap-2 bg-[#F0C020] border-2 border-[#121212] px-3 py-1 shadow-[2px_2px_0px_0px_#121212]">
            <div className="h-2.5 w-2.5 rounded-full bg-[#D02020] border border-[#121212]"></div>
            {session.user?.email}
          </div>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-1.5 bg-[#D02020] hover:bg-[#b01818] text-white border-2 border-[#121212] px-3 py-1.5 shadow-[2px_2px_0px_0px_#121212] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all rounded-none cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">SIGN OUT</span>
          </button>
        </div>
      </header>

      {/* Main Canvas */}
      <main className="flex-1 w-full relative bg-[#F0F0F0] p-6 sm:p-10">
        {/* Bauhaus Graphic Poster Card Calendar */}
        <div className="w-full h-full bg-white rounded-none border-4 border-[#121212] shadow-[8px_8px_0px_0px_#121212] overflow-hidden relative z-0">
          <iframe
            key={refreshKey}
            src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(session.user?.email || "")}&mode=WEEK&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=0&wkst=1&bgcolor=%23ffffff`}
            style={{ borderWidth: 0 }}
            width="100%"
            height="100%"
            frameBorder="0"
            scrolling="yes"
            className="w-full h-full bg-white"
          ></iframe>
        </div>

        {/* Bauhaus Floating Voice Controls */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 w-full px-4 sm:px-0">
          
          {/* Main Voice Dock */}
          <div className="flex items-center gap-4 px-4 py-3 rounded-none bg-[#F0C020] border-4 border-[#121212] shadow-[6px_6px_0px_0px_#121212] transition-all">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading && !isPlaying}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-none border-2 border-[#121212] transition-all shadow-[3px_3px_0px_0px_#121212] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer ${
                isRecording
                  ? "bg-[#D02020] text-white animate-pulse"
                  : isPlaying
                    ? "bg-[#1040C0] text-white"
                    : "bg-white text-[#121212] hover:bg-[#F0F0F0]"
                } disabled:opacity-50`}
            >
              {isRecording ? (
                <Square className="h-5 w-5 fill-current" />
              ) : isPlaying ? (
                <Sparkles className="h-5 w-5" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </button>

            {isPlaying && (
              <div className="flex items-center justify-center gap-[4px] h-6 w-10 shrink-0 pr-2">
                <div className="w-[4px] bg-[#121212] rounded-none h-full" style={{ animation: 'waveform 1s ease-in-out infinite 0.1s' }}></div>
                <div className="w-[4px] bg-[#D02020] rounded-none h-full" style={{ animation: 'waveform 1.2s ease-in-out infinite 0.3s' }}></div>
                <div className="w-[4px] bg-[#1040C0] rounded-none h-full" style={{ animation: 'waveform 0.8s ease-in-out infinite 0.0s' }}></div>
                <div className="w-[4px] bg-[#121212] rounded-none h-full" style={{ animation: 'waveform 1.1s ease-in-out infinite 0.4s' }}></div>
                <div className="w-[4px] bg-[#D02020] rounded-none h-full" style={{ animation: 'waveform 0.9s ease-in-out infinite 0.2s' }}></div>
              </div>
            )}
          </div>

          {/* Secondary Transcription Tab */}
          <div className="flex items-center px-6 py-3 rounded-none bg-white border-4 border-[#121212] shadow-[4px_4px_0px_0px_#121212] transition-all min-w-[300px] max-w-lg w-auto">
            <form onSubmit={sendMessage} className="flex flex-col flex-1 overflow-hidden min-w-0 text-center">
              <span className="text-[10px] font-black tracking-widest uppercase text-[#D02020] mb-0.5">
                {isRecording ? "LISTENING..." : isPlaying ? "SPEAKING..." : isLoading ? "THINKING..." : "VOICE ASSISTANT"}
              </span>
              
              {isRecording || isPlaying || isLoading ? (
                <div className="text-sm text-[#121212] font-bold uppercase truncate w-full animate-fade-in">
                  {messages.length > 0 ? messages[messages.length - 1].content : "Processing..."}
                </div>
              ) : (
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="TAP MIC OR TYPE HERE..."
                  disabled={isRecording || isPlaying}
                  className="w-full bg-transparent border-none p-0 m-0 text-sm text-center text-[#121212] font-bold uppercase placeholder:text-[#121212]/50 focus:ring-0 focus:outline-none"
                />
              )}
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
