"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  Calendar as CalendarIcon,
  LogOut,
  Sparkles,
  Mic,
  Square,
  Terminal,
  Cpu,
  Trash2,
} from "lucide-react";

interface AgentLog {
  id: string;
  stage: "stt" | "llm" | "tool_call" | "tool_result" | "tts" | "info" | "error";
  message: string;
  timestamp: string;
}

type AgentStage = "STANDBY" | "LISTENING" | "THINKING_LLM" | "EXECUTING_TOOL" | "SPEAKING";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [agentStage, setAgentStage] = useState<AgentStage>("STANDBY");
  const [logs, setLogs] = useState<AgentLog[]>([
    {
      id: "init-1",
      stage: "info",
      message: "CalendyAI Agent Initialized.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    },
    {
      id: "init-2",
      stage: "info",
      message: "Engine: Gemini Live Prototype + Google Calendar API Tools.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
  ]);
  const [refreshKey, setRefreshKey] = useState(Date.now());
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [inputText, setInputText] = useState("");

  const logContainerRef = useRef<HTMLDivElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef<number>(0);

  const addLog = (stage: AgentLog["stage"], message: string) => {
    const newLog: AgentLog = {
      id: Math.random().toString(36).substring(7),
      stage,
      message,
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
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, agentStage]);

  const connectWebSocket = () => {
    if (wsRef.current) return;

    addLog("info", "Connecting to Gemini Live WebSocket...");
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/live";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let heartbeatTimer: any = null;

    ws.onopen = () => {
      setIsConnected(true);
      addLog("info", "Connected to Gemini Live Bridge");
      ws.send(JSON.stringify({ type: "INIT", accessToken: (session as any)?.accessToken || "" }));

      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "PING" }));
        }
      }, 8000);
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "READY") {
            addLog("info", "Gemini Multimodal Live API session active.");
            setAgentStage("STANDBY");
          } else if (payload.type === "TEXT_CHUNK") {
            setAgentStage("SPEAKING");
          } else if (payload.type === "TURN_COMPLETE") {
            addLog("info", "⚡ Native Agent End-of-Turn (turnComplete) detected.");
            if (isLiveStreaming) {
              setAgentStage("LISTENING");
            } else {
              setAgentStage("STANDBY");
            }
          } else if (payload.type === "TOOL_LOG") {
            let toolDescription = "to interact with calendar";
            if (payload.tool === "list_events") toolDescription = "to find events";
            if (payload.tool === "create_event") toolDescription = "to create an event";
            if (payload.tool === "update_event") toolDescription = "to update an event";
            if (payload.tool === "delete_event") toolDescription = "to delete an event";

            setAgentStage("EXECUTING_TOOL");
            addLog("tool_call", `Agent called ${payload.tool.replace("_", " ")} tool ${toolDescription}`);
            // addLog("tool_result", `${payload.tool} result: ${JSON.stringify(payload.result)}`); // User requested not to show full results
            // Auto-refresh calendar for mutating tools
            if (payload.tool !== "list_events") {
              setRefreshKey(Date.now());
              addLog("info", "🔄 Calendar embedded view refreshed.");
            }
          } else if (payload.type === "ERROR") {
            addLog("error", `Live Error: ${payload.error}`);
            setAgentStage("STANDBY");
          }
        } catch (e) {}
      } else if (event.data instanceof Blob) {
        // Play 24kHz incoming PCM audio from Gemini
        setAgentStage("SPEAKING");
        playAudioBufferChunk(await event.data.arrayBuffer());
      }
    };

    ws.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      setIsConnected(false);
      setIsLiveStreaming(false);
      setAgentStage("STANDBY");
      addLog("info", "WebSocket closed.");
      wsRef.current = null;
    };

    ws.onerror = (err) => {
      addLog("error", "WebSocket connection error. Check API Permissions.");
    };
  };

  const playAudioBufferChunk = (arrayBuffer: ArrayBuffer) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      nextPlayTimeRef.current = audioCtxRef.current.currentTime;
    }
    const audioCtx = audioCtxRef.current;
    
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0;
    }

    const audioBuffer = audioCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    const startTime = Math.max(audioCtx.currentTime, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + audioBuffer.duration;
  };

  const startLiveStreaming = async () => {
    if (!isConnected) {
      connectWebSocket();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
      mediaStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;

      await audioCtx.audioWorklet.addModule("/pcm_processor.js");
      const sourceNode = audioCtx.createMediaStreamSource(stream);
      const pcmWorklet = new AudioWorkletNode(audioCtx, "pcm-processor");

      pcmWorklet.port.onmessage = (event) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(event.data);
        }
      };

      sourceNode.connect(pcmWorklet);
      setIsLiveStreaming(true);
      setAgentStage("LISTENING");
      addLog("info", "Microphone streaming raw 16kHz PCM audio to Gemini Live API...");
    } catch (err: any) {
      console.error("Mic error:", err);
      addLog("error", `Microphone Error: ${err.message}`);
    }
  };

  const stopLiveStreaming = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    setIsLiveStreaming(false);
    setAgentStage("STANDBY");
    addLog("info", "Microphone streaming stopped.");
  };

  useEffect(() => {
    if (status === "authenticated") {
      connectWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [status]);

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    addLog("llm", `Text Input: "${inputText}"`);
    setInputText("");
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
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center justify-between border-b-4 border-[#121212] bg-white px-8 z-20 relative shadow-[0_4px_0px_0px_#121212]">
        <div className="flex items-center gap-3 font-black text-xl tracking-tighter uppercase text-[#121212]">
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-4 rounded-full bg-[#D02020] border-2 border-[#121212]"></div>
            <div className="h-4 w-4 rounded-none bg-[#1040C0] border-2 border-[#121212]"></div>
            <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[14px] border-b-[#F0C020]"></div>
          </div>
          CALENDY<span className="text-[#D02020]">.AI</span>
        </div>

        <div className="flex items-center gap-6 text-xs font-bold uppercase tracking-wider text-[#121212]">
          <span className={`hidden sm:inline px-2.5 py-1 text-[10px] font-black uppercase tracking-widest border-2 border-[#121212] shadow-[2px_2px_0px_0px_#121212] ${
            isConnected ? "bg-green-400 text-[#121212]" : "bg-red-400 text-white"
          }`}>
            {isConnected ? "WS CONNECTED" : "WS DISCONNECTED"}
          </span>
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

      {/* Main Content */}
      <main className="flex-1 w-full relative bg-[#F0F0F0] p-4 sm:p-6 overflow-y-auto">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-28">

          {/* Calendar Frame (7 Cols) */}
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

          {/* Inspector Console (5 Cols) */}
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

            {/* Stage Indicator */}
            <div className="flex items-center justify-between bg-[#121212] text-white p-3 border-4 border-[#121212] shadow-[4px_4px_0px_0px_#121212]">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-[#F0C020]" />
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-white/70">
                  STAGE:
                </span>
              </div>
              <span className={`text-xs font-mono font-black uppercase tracking-widest px-2.5 py-0.5 rounded-none border border-white/20 ${
                agentStage === "LISTENING"
                  ? "bg-[#D02020] text-white animate-pulse"
                  : agentStage === "THINKING_LLM"
                    ? "bg-[#F0C020] text-[#121212]"
                    : agentStage === "EXECUTING_TOOL"
                      ? "bg-[#1040C0] text-white"
                      : agentStage === "SPEAKING"
                        ? "bg-purple-600 text-white"
                        : "bg-green-600 text-white"
                }`}>
                {agentStage}
              </span>
            </div>

            {/* Terminal Feed */}
            <div className="w-full h-[400px] bg-[#121212] border-4 border-[#121212] shadow-[8px_8px_0px_0px_#121212] p-4 font-mono text-xs overflow-hidden flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-white/20 pb-2 mb-3 text-[10px] text-white/50 uppercase tracking-widest shrink-0">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#D02020]"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-[#F0C020]"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500"></div>
                  <span className="ml-2 font-bold text-white tracking-wider">calendy-agent-inspector</span>
                </div>
                <span>LOGS: {logs.length}</span>
              </div>

              <div ref={logContainerRef} className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                {logs.map((log) => (
                  <div key={log.id} className="text-left leading-relaxed border-l-2 pl-2.5 py-0.5 border-white/15">
                    <div className="flex items-center gap-2 text-[10px] text-white/40">
                      <span>[{log.timestamp}]</span>
                      <span className={`font-bold uppercase ${
                        log.stage === "stt" ? "text-yellow-400" :
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
                      {log.stage.startsWith("tool_") ? (
                        <>
                          <span className="text-pink-300 font-bold bg-pink-500/20 px-1 py-0.5 rounded-sm mr-1 border border-pink-500/30">
                            {log.message.split(" ")[0]}
                          </span>
                          {log.message.substring(log.message.indexOf(" ") + 1)}
                        </>
                      ) : (
                        log.message
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Voice Floating Dock */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 w-full px-4 sm:px-0 max-w-lg">
          <div className="flex items-center gap-4 px-4 py-3 rounded-none bg-[#F0C020] border-4 border-[#121212] shadow-[6px_6px_0px_0px_#121212] transition-all">
            <button
              type="button"
              onClick={isLiveStreaming ? stopLiveStreaming : startLiveStreaming}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-none border-2 border-[#121212] transition-all shadow-[3px_3px_0px_0px_#121212] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer ${
                isLiveStreaming
                  ? "bg-[#D02020] text-white animate-pulse"
                  : agentStage === "SPEAKING"
                    ? "bg-[#1040C0] text-white animate-bounce"
                    : "bg-white text-[#121212] hover:bg-[#F0F0F0]"
                }`}
            >
              {isLiveStreaming ? (
                <Square className="h-5 w-5 fill-current" />
              ) : agentStage === "SPEAKING" ? (
                <Sparkles className="h-5 w-5 animate-spin" />
              ) : (
                <Mic className="h-5 w-5" />
              )}
            </button>

            {agentStage === "SPEAKING" && (
              <div className="flex items-center justify-center gap-[4px] h-6 w-10 shrink-0 pr-2">
                <div className="w-[4px] bg-[#121212] rounded-none h-full animate-bounce"></div>
                <div className="w-[4px] bg-[#D02020] rounded-none h-full animate-bounce delay-100"></div>
                <div className="w-[4px] bg-[#1040C0] rounded-none h-full animate-bounce delay-200"></div>
              </div>
            )}
          </div>

          <div className="flex items-center px-4 py-2 rounded-none bg-white border-4 border-[#121212] shadow-[4px_4px_0px_0px_#121212] transition-all w-full">
            <form onSubmit={handleTextSubmit} className="flex items-center w-full gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isLiveStreaming ? "STREAMING AUDIO..." : agentStage === "SPEAKING" ? "AGENT SPEAKING..." : "TYPE OR TAP MIC TO STREAM..."}
                disabled={isLiveStreaming || agentStage === "SPEAKING"}
                className="flex-1 bg-transparent border-none text-xs font-bold uppercase text-[#121212] focus:outline-none placeholder:text-[#121212]/50"
              />
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
