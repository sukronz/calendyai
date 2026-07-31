# CalendyAI

A voice-first meeting scheduling assistant that integrates directly with Google Calendar. CalendyAI allows users to manage their entire schedule through natural language voice commands, removing the friction of manual calendar interactions.

The application is designed around a single principle: your calendar should be the primary interface, and your voice should be the primary input. There is no chatbot window, no sidebar, no dashboard clutter. Just your weekly schedule with a floating, glassmorphic voice dock at the bottom of the screen.

---

## Table of Contents

- [Features](#features)
- [Local Development Setup](#local-development-setup)
- [Architecture](#architecture)
- [Technologies](#technologies)
- [Design Decisions](#design-decisions)

---

## Features

- **Voice-First Interaction** — Tap the microphone, speak your request, and the assistant handles the rest. Supports continuous hands-free operation with automatic silence detection and auto-resume after each response.
- **Full Calendar CRUD** — Create, read, update, and delete Google Calendar events through natural conversation.
- **Conflict Detection** — The assistant automatically checks for scheduling conflicts before booking a new event and alerts the user if a clash exists.
- **Text-to-Speech Responses** — Every AI response is spoken aloud using Google Cloud TTS, with a synchronized waveform animation in the UI.
- **Glassmorphic Voice Dock** — A frosted-glass floating control bar overlays the calendar, keeping the interface minimal and distraction-free.
- **Fallback Text Input** — Users can also type requests directly into the dock when voice input is not practical.

---

## Local Development Setup

### Prerequisites

- **Node.js** 18+ and npm
- A **Google Cloud** project with the following APIs enabled:
  - Google Calendar API
  - Google Cloud Text-to-Speech API
- **OAuth 2.0 credentials** (Client ID and Client Secret) configured in the Google Cloud Console with `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/)

### 1. Clone the Repository

```bash
git clone https://github.com/sukronz/calendyai.git
cd calendyai
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env.local` file in the project root with the following values:

```env
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_APPLICATION_CREDENTIALS=path/to/your/service-account-key.json
GEMINI_API_KEY=your_gemini_api_key
NEXTAUTH_SECRET=any_random_secret_string
NEXTAUTH_URL=http://localhost:3000
```

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute path to the Google Cloud service account JSON key (required for TTS) |
| `GEMINI_API_KEY` | API key for the Gemini generative model |
| `NEXTAUTH_SECRET` | A random string used to encrypt session tokens |
| `NEXTAUTH_URL` | The base URL of the application |

### 4. Run the Development Server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`. On first visit, you will be redirected to a login page where you must authenticate with a Google account that has calendar access.

---

## Architecture

The application follows a straightforward Next.js App Router architecture with a clear separation between the client-side voice interface and server-side API routes.

```
calendyai/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/   # NextAuth.js Google OAuth handler
│   │   ├── chat/                  # Gemini LLM + function calling endpoint
│   │   ├── stt/                   # Speech-to-Text proxy (Google Cloud)
│   │   ├── tts/                   # Text-to-Speech proxy (Google Cloud)
│   │   └── events/                # Direct calendar event CRUD endpoint
│   ├── login/                     # Login page
│   ├── page.tsx                   # Main dashboard (calendar + voice dock)
│   ├── layout.tsx                 # Root layout with session provider
│   ├── providers.tsx              # NextAuth SessionProvider wrapper
│   └── globals.css                # Global styles and animations
├── lib/
│   ├── authOptions.ts             # NextAuth configuration (Google OAuth + Calendar scope)
│   └── calendar.ts                # Google Calendar API client (list, create, update, delete)
└── package.json
```

### Request Flow

The following describes the end-to-end lifecycle of a single voice interaction:

```
User speaks → MediaRecorder captures audio
                ↓
        POST /api/stt (audio blob)
                ↓
    Google Cloud STT returns transcript
                ↓
        POST /api/chat (transcript + history)
                ↓
    Gemini processes with function calling
        ↓ (if scheduling action detected)
    Gemini calls list_events → checks conflicts
        ↓
    Gemini calls create_event / update_event / delete_event
        ↓
    Gemini returns natural language confirmation
                ↓
        POST /api/tts (response text)
                ↓
    Google Cloud TTS returns audio
                ↓
    Browser plays audio → auto-resumes microphone
```

### Function Calling

The chat API route registers four function declarations with the Gemini model:

| Function | Purpose |
|---|---|
| `list_events` | Queries Google Calendar for events within a given time range |
| `create_event` | Creates a new calendar event with title, start/end time, and optional attendees |
| `update_event` | Patches an existing event (title, time, attendees) by event ID |
| `delete_event` | Removes an event from the calendar by event ID |

The model autonomously decides when to call these functions based on the user's natural language input. The server executes the function, returns the result to the model, and the model formulates a human-readable response.

---

## Technologies

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | Full-stack React framework with server-side API routes |
| **Language** | TypeScript | Type safety across client and server code |
| **Authentication** | NextAuth.js v4 (Google Provider) | OAuth 2.0 login with Google Calendar scope |
| **LLM** | Google Gemini (via `@google/generative-ai`) | Natural language understanding and function calling |
| **Calendar** | Google Calendar API (via `googleapis`) | CRUD operations on user calendar events |
| **Speech-to-Text** | Google Cloud Speech-to-Text v2 | Transcribes user voice input to text |
| **Text-to-Speech** | Google Cloud Text-to-Speech | Converts AI responses to spoken audio |
| **Styling** | Tailwind CSS v4 | Utility-first CSS for the glassmorphic UI |
| **Icons** | Lucide React | Lightweight icon library |
| **Silence Detection** | Web Speech API (`webkitSpeechRecognition`) | Detects when the user stops speaking to auto-submit |

---

## Design Decisions

### Voice as the primary interface

The application was intentionally built without a persistent chat log or message history panel. Traditional chatbot interfaces place text front and center, which conflicts with the goal of a voice-first experience. Instead, the floating dock shows only the most recent transcript inline and speaks the response aloud. The calendar itself is the UI — the voice dock is merely the control layer on top of it.

### Glassmorphic dock over the calendar

The voice dock uses a `backdrop-filter: blur` with a semi-transparent white fill to create a frosted glass effect. This was chosen specifically to avoid visually competing with the calendar. A solid, opaque control bar would create a hard visual boundary and make the interface feel heavier. The glass effect allows the calendar grid to subtly bleed through, reinforcing the idea that the dock is a lightweight overlay rather than a separate panel.

### Word-based silence detection over volume thresholds

Early versions used an `AudioContext` with frequency analysis to detect silence by monitoring volume levels. This approach was unreliable in real-world conditions — background noise from fans, keyboards, or ambient sound would keep the volume above the threshold and prevent auto-stop. The current implementation uses the browser's native `webkitSpeechRecognition` API running in parallel. It resets a 3-second timer every time a word is detected, rather than every time a sound is detected. This is far more robust and accurately captures the user's intent to stop speaking.

### Hands-free continuous loop

After the AI finishes speaking its last TTS sentence, the microphone automatically re-engages. This creates a continuous conversational loop where the user never needs to tap the screen. The design mirrors how a real human assistant would work: they listen, respond, then listen again. This is critical for the target use case of managing a calendar while multitasking.

### Google Calendar iframe embedding

Rather than building a custom calendar renderer, the application embeds Google Calendar via an iframe. This was a deliberate trade-off: the embedded calendar provides feature parity with Google Calendar (drag-to-resize events, week/day/month views, timezone handling) without any maintenance burden. The slight loss of visual customization is offset by the reliability and familiarity of the native Google Calendar interface.
