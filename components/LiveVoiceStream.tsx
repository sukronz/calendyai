"use client";

import React, { useState, useEffect, useRef } from "react";
import { Mic, Square, Sparkles, Activity, Radio, AlertCircle } from "lucide-react";

interface LiveVoiceStreamProps {
  accessToken: string;
}

export default function LiveVoiceStream({ accessToken }: LiveVoiceStreamProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Disconnected");
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [textChunks, setTextChunks] = useState<string>("");

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const addLiveLog = (msg: string) => {
    setLiveLogs(prev => [...prev.slice(-20), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const connectWebSocket = () => {
    if (wsRef.current) return;

    setStatusMessage("Connecting to Gemini Live WebSocket...");
    const ws = new WebSocket("ws://localhost:8000/ws/live");
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setStatusMessage("Connected to Gemini Live Bridge");
      addLiveLog("WebSocket connected to ws://localhost:8000/ws/live");
      ws.send(JSON.stringify({ type: "INIT", accessToken }));
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "READY") {
            setStatusMessage("Gemini 3.1 Flash Lite Live Stream Ready!");
            addLiveLog("Gemini Multimodal Live API (gemini-3.1-flash-lite) session active.");
          } else if (payload.type === "TEXT_CHUNK") {
            setTextChunks(prev => prev + payload.text);
          } else if (payload.type === "TURN_COMPLETE") {
            addLiveLog("⚡ Native Agent End-of-Turn (turnComplete) detected.");
          } else if (payload.type === "TOOL_LOG") {
            addLiveLog(`Calendar Tool Executed: ${payload.tool} — ${JSON.stringify(payload.result)}`);
          } else if (payload.type === "ERROR") {
            setStatusMessage(`Live Error: ${payload.error}`);
            addLiveLog(`Error: ${payload.error}`);
          }
        } catch (e) {}
      } else if (event.data instanceof Blob) {
        // Play 24kHz incoming PCM audio from Gemini
        playAudioBufferChunk(await event.data.arrayBuffer());
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsLiveStreaming(false);
      setStatusMessage("Disconnected from Live WebSocket");
      addLiveLog("WebSocket closed.");
      wsRef.current = null;
    };

    ws.onerror = (err) => {
      console.error("Live WebSocket Error:", err);
      setStatusMessage("Live Stream Error");
    };
  };

  const playAudioBufferChunk = (arrayBuffer: ArrayBuffer) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const audioCtx = audioCtxRef.current;
    
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
    source.start(0);
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
      setStatusMessage("Live PCM Audio Streaming Active");
      addLiveLog("Microphone streaming raw 16kHz PCM audio to Gemini Live API...");
    } catch (err: any) {
      console.error("Mic error:", err);
      setStatusMessage(`Microphone Error: ${err.message}`);
    }
  };

  const stopLiveStreaming = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    setIsLiveStreaming(false);
    setStatusMessage("Live Streaming Stopped");
    addLiveLog("Microphone streaming stopped.");
  };

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="w-full bg-white border-4 border-[#121212] p-6 shadow-[8px_8px_0px_0px_#121212] font-mono text-xs">
      <div className="flex items-center justify-between border-b-4 border-[#121212] pb-3 mb-4">
        <div className="flex items-center gap-3">
          <Radio className={`h-5 w-5 ${isLiveStreaming ? "text-[#D02020] animate-pulse" : "text-[#121212]"}`} />
          <span className="font-black text-sm uppercase tracking-wider text-[#121212]">
            GEMINI MULTIMODAL LIVE PROTOTYPE
          </span>
        </div>
        <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest border-2 border-[#121212] shadow-[2px_2px_0px_0px_#121212] ${
          isConnected ? "bg-green-400 text-[#121212]" : "bg-red-400 text-white"
        }`}>
          {isConnected ? "WS CONNECTED" : "WS DISCONNECTED"}
        </span>
      </div>

      <div className="mb-4 bg-[#F0F0F0] border-2 border-[#121212] p-3 shadow-[2px_2px_0px_0px_#121212] flex items-center justify-between">
        <span className="font-bold text-[#121212]">STATUS: {statusMessage}</span>
        {isLiveStreaming && (
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase text-[#D02020] animate-pulse">
            <Activity className="h-3.5 w-3.5" /> LIVE AUDIO PCM STREAMING
          </span>
        )}
      </div>

      <div className="flex items-center justify-center my-6">
        <button
          type="button"
          onClick={isLiveStreaming ? stopLiveStreaming : startLiveStreaming}
          className={`flex items-center gap-3 px-6 py-4 font-black uppercase text-sm border-4 border-[#121212] shadow-[6px_6px_0px_0px_#121212] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all cursor-pointer ${
            isLiveStreaming 
              ? "bg-[#D02020] text-white animate-bounce" 
              : "bg-[#F0C020] hover:bg-[#e0b010] text-[#121212]"
          }`}
        >
          {isLiveStreaming ? (
            <>
              <Square className="h-5 w-5 fill-current" />
              <span>STOP LIVE STREAMING</span>
            </>
          ) : (
            <>
              <Mic className="h-5 w-5" />
              <span>START GEMINI MULTIMODAL LIVE STREAM</span>
            </>
          )}
        </button>
      </div>

      {textChunks && (
        <div className="mb-4 bg-white border-2 border-[#121212] p-3 shadow-[2px_2px_0px_0px_#121212]">
          <span className="font-bold text-[#D02020] block mb-1">GEMINI LIVE TEXT:</span>
          <p className="text-gray-800 leading-relaxed">{textChunks}</p>
        </div>
      )}

      <div className="bg-[#121212] text-green-400 p-3 border-2 border-[#121212] h-40 overflow-y-auto space-y-1 text-[11px]">
        <div className="text-white/50 text-[9px] uppercase tracking-widest border-b border-white/20 pb-1 mb-1">
          LIVE PROTOCOL INSPECTOR LOGS
        </div>
        {liveLogs.map((log, idx) => (
          <div key={idx}>{log}</div>
        ))}
      </div>
    </div>
  );
}
