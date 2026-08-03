import os
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment variables from .env.local or .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))
load_dotenv()

app = FastAPI(title="Calendy AI Backend", version="1.0.0")

# CORS setup for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    text: Optional[str] = None
    messages: Optional[List[Dict[str, Any]]] = None
    accessToken: str

from fastapi import WebSocket

@app.websocket("/ws/voice")
async def voice_websocket_endpoint(websocket: WebSocket):
    from services.websocket_handler import handle_voice_websocket
    await handle_voice_websocket(websocket)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "calendy-backend"}

@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    if not req.accessToken:
        raise HTTPException(status_code=401, detail="Unauthorized: Access token is required")

    try:
        from services import ai_service
        result = ai_service.process_chat(
            text=req.text,
            messages=req.messages,
            access_token=req.accessToken
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
