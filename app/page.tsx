"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  Send,
  Calendar as CalendarIcon,
  LogOut,
  Sparkles,
  Mic,
  Square,
  Terminal,
  Cpu,
  Trash2,
  Wrench,
  CheckCircle2,
  Clock,
  Volume2,
  Activity
} from "lucide-react";

interface AgentLog {
  id: string;
  stage: "stt" | "llm" | "tool_call" | "tool_result" | "tts" | "info" | "error";
  message: string;
  payload?: any;
  timestamp: string;
}

type AgentStage = "STANDBY" | "RECORDING_STT" | "THINKING_LLM" | "EXECUTING_TOOL" | "SYNTHESIZING_TTS";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [messages, setMessages] = useState<{ role: "user" | "agent", content: string }[]>([
    { role: "agent", content: "Hello! I am your AI scheduling assistant. Speak or type your request to manage your calendar." }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Agent Execution Telemetry State
  const [agentStage, setAgentStage] = useState<AgentStage>("STANDBY");
  const [logs, setLogs] = useState<AgentLog[]>([
    {
      id: "init-1",
      stage: "info",
      message: "CalendyAI Agent Telemetry Initialized.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    },
    {
      id: "init-2",
      stage: "info",
      message: "Services online: Google STT, Gemini 3.5 Flash Lite, Google Calendar API Tools, Google TTS.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
  ]);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const messagesRef = useRef<{ role: "user" | "agent", content: string }[]>([]);

  // Silence detection refs
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasSpokenRef = useRef<boolean>(false);
  const browserTranscriptRef = useRef<string>("");

  // Audio playback queue refs
  const textQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);

  const addLog = (stage: AgentLog["stage"], message: string, payload?: any) => {
    const newLog: AgentLog = {
      id: Math.random().toString(36).substring(7),
      stage,
      message,
      payload,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    setLogs(prev => [...prev.slice(-49), newLog]);
  };

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

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, agentStage]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      isRecordingRef.current = true;
      hasSpokenRef.current = false;
      browserTranscriptRef.current = "";

      setAgentStage("RECORDING_STT");
      addLog("stt", "Microphone stream opened. Listening for user input...");

      // Hybrid Silence Detection
      const audioContext = new window.AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.minDecibels = -60;
      source.connect(analyser);
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const startSilenceCountdown = () => {
        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = setTimeout(() => {
          if (isRecordingRef.current) stopRecording();
        }, 2000);
      };

      const checkVolume = () => {
        if (!isRecordingRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        let isLoud = false;
        for (let i = 0; i < bufferLength; i++) {
          if (dataArray[i] > 30) {
            isLoud = true;
            break;
          }
        }

        if (isLoud) {
          if (!hasSpokenRef.current) {
            hasSpokenRef.current = true;
            addLog("stt", "User speech detected. Monitoring cadence...");
          }
          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }
        } else if (hasSpokenRef.current) {
          if (!silenceTimeoutRef.current) {
            startSilenceCountdown();
          }
        }
        requestAnimationFrame(checkVolume);
      };
      checkVolume();

      // SpeechRecognition reinforcement
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognitionRef.current = recognition;

        recognition.onresult = (event: any) => {
          hasSpokenRef.current = true;
          let transcript = "";
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          browserTranscriptRef.current = transcript;

          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }
          startSilenceCountdown();
        };

        recognition.onend = () => {
          if (isRecordingRef.current) {
            try { recognition.start(); } catch (e) { }
          }
        };

        recognition.onerror = (event: any) => {
          if (event.error !== "no-speech") {
            console.error("Speech recognition error:", event.error);
          }
        };

        try {
          recognition.start();
        } catch (e) {
          console.error("Speech recognition failed to start", e);
        }
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        addLog("stt", "2s silence threshold reached. Closing microphone stream.");
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processVoiceInput(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      addLog("error", "Failed to access microphone hardware.");
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
      try { recognitionRef.current.stop(); } catch (e) { }
      recognitionRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) { }
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
    setAgentStage("THINKING_LLM");
    addLog("stt", "Uploading WebM audio payload to Google Speech-to-Text (/api/stt)...");

    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");

      const sttRes = await fetch("/api/stt", {
        method: "POST",
        body: formData,
      });

      const sttData = await sttRes.json();
      if (sttData.text && sttData.text.trim()) {
        addLog("stt", `STT Transcription Result: "${sttData.text}"`);
        await executeMessageFlow(sttData.text);
      } else {
        // Quiet audio / no speech detected
        setIsLoading(false);
        setAgentStage("STANDBY");
        setTimeout(() => startRecording(), 100);
      }
    } catch (err: any) {
      console.error("STT error:", err);
      setIsLoading(false);
      setAgentStage("STANDBY");
      setTimeout(() => startRecording(), 100);
    }
  };

  const playTTS = (text: string) => {
    if (!text) return;
    const cleanText = text.replace(/[*#]/g, "");
    textQueueRef.current.push(cleanText);
    processTextQueue();
  };

  const processTextQueue = async () => {
    if (isPlayingRef.current || textQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    setIsPlaying(true);
    setAgentStage("SYNTHESIZING_TTS");
    const text = textQueueRef.current.shift()!;
    addLog("tts", "Sending speech text to Google Text-to-Speech (/api/tts)...");

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (res.ok) {
        addLog("tts", "Received OGG_OPUS audio stream payload. Starting playback.");
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
            setAgentStage("STANDBY");
            addLog("info", "Audio playback complete. Re-arming microphone for continuous loop.");
            startRecording();
          }
        };
      } else {
        isPlayingRef.current = false;
        setIsPlaying(false);
        setAgentStage("STANDBY");
        processTextQueue();
      }
    } catch (err: any) {
      console.error("TTS error:", err);
      addLog("error", `TTS Error: ${err.message}`);
      isPlayingRef.current = false;
      setIsPlaying(false);
      setAgentStage("STANDBY");
      processTextQueue();
    }
  };

  const executeMessageFlow = async (text: string) => {
    const newUserMsg = { role: "user" as const, content: text };
    const newMsgs = [...messagesRef.current, newUserMsg];

    setMessages(newMsgs);
    fetchChatResponse(newMsgs);
  };

  const fetchChatResponse = async (history: any[]) => {
    setIsLoading(true);
    setAgentStage("THINKING_LLM");
    addLog("llm", `Invoking Gemini 3.5 Flash Lite with ${history.length} messages in context.`);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      const data = await response.json();

      // Log tool call telemetry if tools were executed
      if (data.toolLogs && data.toolLogs.length > 0) {
        data.toolLogs.forEach((log: any) => {
          let toolDescription = "Calendar Tool Execution";
          if (log.tool === "list_events") toolDescription = "Checking Schedule & Conflict Detection";
          else if (log.tool === "create_event") toolDescription = "Booking New Calendar Event";
          else if (log.tool === "update_event") toolDescription = "Updating Existing Calendar Event";
          else if (log.tool === "delete_event") toolDescription = "Deleting Calendar Event";

          setAgentStage("EXECUTING_TOOL");
          addLog("tool_call", `[Tool Invoked] ${log.tool}() — ${toolDescription}`, log.args);
          addLog("tool_result", `[Tool Result] ${log.tool}() completed`, log.result);
        });
      }

      const reply = data.reply || data.error || "Sorry, I encountered an unexpected error.";
      addLog("llm", `LLM Response generated: "${reply}"`);
      setMessages((prev) => [...prev, { role: "agent", content: reply }]);

      setRefreshKey(Date.now());
      playTTS(reply);

    } catch (error: any) {
      console.error("Chat error:", error);
      addLog("error", `Chat Error: ${error.message}`);
      setMessages((prev) => [...prev, { role: "agent", content: "Sorry, I encountered an error while processing your request." }]);
      setAgentStage("STANDBY");
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    addLog("info", `User submitted typed directive: "${userMessage}"`);
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

      {/* Main Canvas Split into Compact Calendar + Agent Inspector */}
      <main className="flex-1 w-full relative bg-[#F0F0F0] p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-28">

          {/* Column 1: Compact Google Calendar Frame (7 Cols) */}
          <div className="lg:col-span-7 flex flex-col space-y-3">
            <div className="flex items-center justify-between border-b-2 border-[#121212] pb-2">
              <div className="flex items-center gap-2 font-black text-xs sm:text-sm uppercase tracking-wider text-[#121212]">
                <CalendarIcon className="h-4 w-4 text-[#D02020]" />
                <span>PRIMARY GOOGLE CALENDAR VIEW</span>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest bg-[#F0C020] border-2 border-[#121212] px-2 py-0.5 shadow-[2px_2px_0px_0px_#121212]">
                LIVE EMBED
              </span>
            </div>

            {/* Compact Calendar Frame */}
            <div className="w-full h-[460px] bg-white rounded-none border-4 border-[#121212] shadow-[8px_8px_0px_0px_#121212] overflow-hidden relative z-0">
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
          </div>

          {/* Column 2: Agent Execution Telemetry & Tool Call Log Console (Claude Code Style - 5 Cols) */}
          <div className="lg:col-span-5 flex flex-col space-y-3">
            <div className="flex items-center justify-between border-b-2 border-[#121212] pb-2">
              <div className="flex items-center gap-2 font-black text-xs sm:text-sm uppercase tracking-wider text-[#121212]">
                <Terminal className="h-4 w-4 text-[#1040C0]" />
                <span>AGENT TOOL & TELEMETRY INSPECTOR</span>
              </div>
              <button
                onClick={() => setLogs([])}
                className="text-[10px] font-bold uppercase tracking-widest bg-white hover:bg-gray-100 border-2 border-[#121212] px-2 py-0.5 shadow-[2px_2px_0px_0px_#121212] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none cursor-pointer flex items-center gap-1"
                title="Clear Logs"
              >
                <Trash2 className="h-3 w-3 text-[#D02020]" />
                <span>CLEAR</span>
              </button>
            </div>

            {/* Stage Banner */}
            <div className="flex items-center justify-between bg-[#121212] text-white p-3 border-4 border-[#121212] shadow-[4px_4px_0px_0px_#121212]">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-[#F0C020]" />
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-white/70">
                  STAGE:
                </span>
              </div>
              <span className={`text-xs font-mono font-black uppercase tracking-widest px-2.5 py-0.5 rounded-none border border-white/20 ${agentStage === "RECORDING_STT"
                  ? "bg-[#D02020] text-white animate-pulse"
                  : agentStage === "THINKING_LLM"
                    ? "bg-[#F0C020] text-[#121212]"
                    : agentStage === "EXECUTING_TOOL"
                      ? "bg-[#1040C0] text-white"
                      : agentStage === "SYNTHESIZING_TTS"
                        ? "bg-purple-600 text-white"
                        : "bg-green-600 text-white"
                }`}>
                {agentStage}
              </span>
            </div>

            {/* Claude Code Style Terminal Output Box */}
            <div className="w-full h-[400px] bg-[#121212] border-4 border-[#121212] shadow-[8px_8px_0px_0px_#121212] p-4 font-mono text-xs overflow-hidden flex flex-col justify-between">

              {/* Window Controls Header */}
              <div className="flex items-center justify-between border-b border-white/20 pb-2 mb-3 text-[10px] text-white/50 uppercase tracking-widest shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#D02020]"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-[#F0C020]"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500"></div>
                  <span className="ml-2 font-bold text-white tracking-wider">calendy-agent-inspector</span>
                </div>
                <span>LOGS: {logs.length}</span>
              </div>

              {/* Scrollable Telemetry Feed */}
              <div ref={logContainerRef} className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                {logs.map((log) => (
                  <div key={log.id} className="text-left leading-relaxed border-l-2 pl-2.5 py-0.5 border-white/15">
                    <div className="flex items-center gap-2 text-[10px] text-white/40">
                      <span>[{log.timestamp}]</span>
                      <span className={`font-bold uppercase ${log.stage === "stt" ? "text-yellow-400" :
                          log.stage === "llm" ? "text-cyan-400" :
                            log.stage === "tool_call" ? "text-pink-400 font-black" :
                              log.stage === "tool_result" ? "text-green-400 font-black" :
                                log.stage === "tts" ? "text-purple-400" :
                                  log.stage === "error" ? "text-red-500 font-bold" : "text-gray-300"
                        }`}>
                        [{log.stage.toUpperCase()}]
                      </span>
                    </div>
                    <div className="text-white/90 text-[11px] font-medium break-words mt-0.5">
                      {log.message}
                    </div>

                    {/* Formatted Payload Code Block for Tool Calls */}
                    {log.payload && (
                      <pre className="bg-black/70 text-green-400 p-2 mt-1 rounded-none border border-white/10 text-[10px] overflow-x-auto whitespace-pre-wrap font-mono">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

        {/* Bauhaus Floating Voice Controls */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 w-full px-4 sm:px-0 max-w-lg">

          {/* Main Voice Dock */}
          <div className="flex items-center gap-4 px-4 py-3 rounded-none bg-[#F0C020] border-4 border-[#121212] shadow-[6px_6px_0px_0px_#121212] transition-all">
            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isLoading && !isPlaying}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-none border-2 border-[#121212] transition-all shadow-[3px_3px_0px_0px_#121212] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer ${isRecording
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
          <div className="flex items-center px-6 py-3 rounded-none bg-white border-4 border-[#121212] shadow-[4px_4px_0px_0px_#121212] transition-all w-full">
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
