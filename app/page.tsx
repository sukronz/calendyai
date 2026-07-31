"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { Send, Calendar as CalendarIcon, LogOut, Bot, User, Sparkles, Mic, Square } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [messages, setMessages] = useState<{role: "user" | "agent", content: string}[]>([
    { role: "agent", content: "Hello! I am your AI scheduling assistant. How can I help you manage your calendar today?" }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [isRecording, setIsRecording] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const messagesRef = useRef<{role: string, content: string}[]>([]);
  
  // Silence detection refs
  const audioContextRef = useRef<AudioContext | null>(null);
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, refreshKey]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      isRecordingRef.current = true;

      // Silence Detection Logic
      const audioContext = new window.AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.minDecibels = -60;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkSilence = () => {
        if (!isRecordingRef.current) return;
        
        analyser.getByteFrequencyData(dataArray);
        let isSilent = true;
        for (let i = 0; i < bufferLength; i++) {
          if (dataArray[i] > 15) { // Amplitude threshold for "speaking"
            isSilent = false;
            break;
          }
        }

        if (isSilent) {
          if (!silenceTimeoutRef.current) {
            silenceTimeoutRef.current = setTimeout(() => {
              if (isRecordingRef.current) {
                stopRecording();
              }
            }, 2000); // 2 seconds of silence
          }
        } else {
          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }
        }
        
        requestAnimationFrame(checkSilence);
      };
      
      checkSilence();

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
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
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
          processTextQueue();
        });
        
        audio.onended = () => {
          isPlayingRef.current = false;
          processTextQueue();
        };
      } else {
        isPlayingRef.current = false;
        processTextQueue();
      }
    } catch (err) {
      console.error("TTS error:", err);
      isPlayingRef.current = false;
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
    <div className="flex h-screen flex-col bg-[#f5f5f7] font-sans antialiased text-[#1d1d1f]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#d2d2d7]/40 bg-[#f5f5f7]/80 backdrop-blur-md px-8 z-20 sticky top-0">
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

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 overflow-hidden p-6 sm:p-8 gap-8">
        
        {/* Chat Main Area */}
        <main className="flex w-full flex-col bg-white rounded-3xl shadow-sm border border-[#d2d2d7]/50 md:w-[55%] overflow-hidden relative z-10">
          <div className="flex items-center justify-between px-8 py-5 border-b border-[#d2d2d7]/30 bg-white">
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#86868b]" />
              Scheduling Assistant
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 bg-white">
            <div className="flex flex-col gap-6">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${msg.role === "user" ? "bg-[#0071e3] text-white" : "bg-[#f5f5f7] text-[#1d1d1f]"}`}>
                    {msg.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div className={`rounded-2xl px-5 py-3 text-[15px] leading-relaxed max-w-[80%] ${
                    msg.role === "user" 
                      ? "bg-[#0071e3] text-white" 
                      : "bg-[#f5f5f7] text-[#1d1d1f]"
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex flex-row gap-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[#1d1d1f]">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex items-center gap-1.5 rounded-2xl bg-[#f5f5f7] px-5 py-4">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-[#86868b] [animation-delay:-0.3s]"></div>
                    <div className="h-2 w-2 animate-bounce rounded-full bg-[#86868b] [animation-delay:-0.15s]"></div>
                    <div className="h-2 w-2 animate-bounce rounded-full bg-[#86868b]"></div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="bg-white p-6 border-t border-[#d2d2d7]/30">
            <form onSubmit={sendMessage} className="relative flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask me to schedule a meeting..."
                  disabled={isRecording}
                  className="w-full rounded-full border border-[#d2d2d7] bg-[#f5f5f7] py-3.5 pl-6 pr-14 text-[15px] text-[#1d1d1f] placeholder:text-[#86868b] focus:bg-white focus:border-[#0071e3] focus:ring-1 focus:ring-[#0071e3] focus:outline-none transition-all disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim() || isRecording}
                  className="absolute right-2 top-[5px] flex h-9 w-9 items-center justify-center rounded-full bg-[#0071e3] text-white transition-all hover:bg-[#0077ed] disabled:bg-[#d2d2d7] disabled:opacity-50"
                >
                  <Send className="h-4 w-4 ml-0.5" />
                </button>
              </div>
              
              <button
                type="button"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all shadow-sm ${
                  isRecording 
                    ? "bg-red-500 text-white animate-pulse shadow-md shadow-red-500/30" 
                    : "bg-[#f5f5f7] text-[#1d1d1f] border border-[#d2d2d7] hover:bg-[#e8e8ed]"
                } disabled:opacity-50`}
              >
                {isRecording ? <Square className="h-5 w-5 fill-current" /> : <Mic className="h-5 w-5" />}
              </button>
            </form>
          </div>
        </main>

        {/* Calendar iframe Side Pane */}
        <aside className="hidden w-[45%] flex-col bg-white rounded-3xl shadow-sm border border-[#d2d2d7]/50 md:flex overflow-hidden relative z-10">
          <div className="flex items-center justify-between px-8 py-5 border-b border-[#d2d2d7]/30 bg-white">
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] tracking-tight flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-[#86868b]" /> 
              This Week
            </h2>
          </div>
          <div className="flex-1 w-full bg-white">
            <iframe 
               key={refreshKey}
               src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(session.user?.email || "")}&mode=WEEK&showTitle=0&showNav=1&showDate=1&showPrint=0&showTabs=1&showCalendars=0&showTz=0&wkst=1&bgcolor=%23ffffff`} 
               style={{borderWidth:0}} 
               width="100%" 
               height="100%" 
               frameBorder="0" 
               scrolling="yes"
               className="w-full h-full"
            ></iframe>
          </div>
        </aside>

      </div>
    </div>
  );
}
