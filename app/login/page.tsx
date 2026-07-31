"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#F0F0F0] px-4 relative overflow-hidden">
      {/* Decorative Bauhaus Background Shapes */}
      <div className="absolute top-12 left-12 h-32 w-32 rounded-full bg-[#D02020] border-4 border-[#121212] opacity-90 hidden sm:block"></div>
      <div className="absolute bottom-16 right-16 h-40 w-40 bg-[#1040C0] border-4 border-[#121212] rotate-12 opacity-90 hidden sm:block"></div>
      <div 
        className="absolute top-1/4 right-20 w-0 h-0 border-l-[60px] border-l-transparent border-r-[60px] border-r-transparent border-b-[100px] border-b-[#F0C020] opacity-90 hidden md:block"
        style={{ filter: "drop-shadow(4px 4px 0px #121212)" }}
      ></div>

      {/* Main Constructivist Poster Card */}
      <div className="relative z-10 w-full max-w-lg bg-white border-4 border-[#121212] shadow-[10px_10px_0px_0px_#121212] p-8 sm:p-12 text-center rounded-none">
        
        {/* Geometric Composition Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="h-8 w-8 rounded-full bg-[#D02020] border-2 border-[#121212] shadow-[2px_2px_0px_0px_#121212]"></div>
          <div className="h-8 w-8 rounded-none bg-[#1040C0] border-2 border-[#121212] shadow-[2px_2px_0px_0px_#121212]"></div>
          <div 
            className="w-0 h-0 border-l-[16px] border-l-transparent border-r-[16px] border-r-transparent border-b-[28px] border-b-[#F0C020]"
            style={{ filter: "drop-shadow(2px 2px 0px #121212)" }}
          ></div>
        </div>

        <h1 className="text-4xl sm:text-6xl font-black uppercase tracking-tighter text-[#121212] leading-[0.9] mb-4">
          CALENDY<span className="text-[#D02020]">.AI</span>
        </h1>
        
        <div className="inline-block bg-[#F0C020] border-2 border-[#121212] px-3 py-1 mb-6 shadow-[3px_3px_0px_0px_#121212]">
          <span className="text-xs font-black uppercase tracking-widest text-[#121212]">
            VOICE SCHEDULING ASSISTANT
          </span>
        </div>

        <p className="mb-8 text-base font-medium text-[#121212] leading-relaxed">
          Connect your Google Calendar to unlock effortless, hands-free intelligent voice scheduling. Form follows function.
        </p>
        
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="flex w-full items-center justify-center gap-3 bg-[#F0C020] hover:bg-[#e0b010] text-[#121212] font-black uppercase tracking-wider text-sm px-6 py-4 border-4 border-[#121212] shadow-[6px_6px_0px_0px_#121212] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all rounded-none cursor-pointer"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#121212"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#121212"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              fill="#121212"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              fill="#121212"
            />
          </svg>
          AUTHENTICATE WITH GOOGLE
        </button>

        {/* Footer Accent */}
        <div className="mt-8 pt-4 border-t-2 border-[#121212] flex items-center justify-between text-[10px] font-bold tracking-widest uppercase text-[#121212]">
          <span>BAUHAUS EDITION</span>
          <span>EST. 2026</span>
        </div>
      </div>
    </div>
  );
}
