import os
import json
import asyncio
from typing import Dict, Any
from fastapi import WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from services import calendar_service

LIVE_TOOLS = [
    types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name="list_events",
            description="Lists upcoming calendar events for the user between a start and end time.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "timeMin": types.Schema(type="STRING", description="Start of time range (ISO string)"),
                    "timeMax": types.Schema(type="STRING", description="End of time range (ISO string)")
                },
                required=["timeMin", "timeMax"]
            )
        ),
        types.FunctionDeclaration(
            name="create_event",
            description="Schedules a new meeting or event on the user's Google Calendar.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "title": types.Schema(type="STRING", description="Title of the meeting"),
                    "startTime": types.Schema(type="STRING", description="Start time in ISO format"),
                    "endTime": types.Schema(type="STRING", description="End time in ISO format"),
                    "attendees": types.Schema(type="ARRAY", items=types.Schema(type="STRING"), description="Optional attendee emails")
                },
                required=["title", "startTime", "endTime"]
            )
        )
    ])
]

async def handle_gemini_live_websocket(websocket: WebSocket):
    await websocket.accept()
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        await websocket.send_json({"type": "ERROR", "error": "GEMINI_API_KEY is missing"})
        await websocket.close()
        return

    client = genai.Client(api_key=api_key)
    access_token = ""

    # Wait for INIT handshake from client
    init_msg = await websocket.receive_text()
    try:
        init_payload = json.loads(init_msg)
        access_token = init_payload.get("accessToken", "")
    except Exception:
        pass

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
            )
        ),
        tools=LIVE_TOOLS
    )

    try:
        async with client.aio.live.connect(model="gemini-3.1-flash-live-preview", config=config) as session:
            await websocket.send_json({"type": "READY", "mode": "gemini-multimodal-live"})

            async def receive_from_client():
                """Reads client audio bytes or control frames and forwards to Gemini Live Session."""
                try:
                    while True:
                        msg = await websocket.receive()
                        if "bytes" in msg and msg["bytes"]:
                            pcm_data = msg["bytes"]
                            await session.send_realtime_input(
                                audio=types.Blob(data=pcm_data, mime_type="audio/pcm")
                            )
                        elif "text" in msg and msg["text"]:
                            data = json.loads(msg["text"])
                            if data.get("type") == "TEXT_PROMPT":
                                text_prompt = data.get("prompt", "")
                                await session.send_client_content(
                                    turns=[types.Content(parts=[types.Part.from_text(text=text_prompt)])],
                                    turn_complete=True
                                )
                except (WebSocketDisconnect, asyncio.CancelledError):
                    pass

            async def receive_from_gemini():
                """Reads responses from Gemini Live Session and forwards audio & tools to client."""
                try:
                    async for response in session.receive():
                        server_content = response.server_content
                        if server_content:
                            model_turn = server_content.model_turn
                            if model_turn:
                                for part in model_turn.parts:
                                    if part.inline_data:
                                        await websocket.send_bytes(part.inline_data.data)
                                    elif part.text:
                                        await websocket.send_json({
                                            "type": "TEXT_CHUNK",
                                            "text": part.text
                                        })

                            if server_content.turn_complete:
                                await websocket.send_json({"type": "TURN_COMPLETE"})

                        tool_call = response.tool_call
                        if tool_call:
                            function_responses = []
                            for call in tool_call.function_calls:
                                name = call.name
                                args = dict(call.args) if call.args else {}
                                result = {}

                                try:
                                    if name == "list_events":
                                        events = calendar_service.list_events(access_token, args.get("timeMin", ""), args.get("timeMax", ""))
                                        result = {"eventsCount": len(events), "events": events}
                                    elif name == "create_event":
                                        event = calendar_service.create_event(
                                            access_token,
                                            args.get("title", "Meeting"),
                                            args.get("startTime", ""),
                                            args.get("endTime", ""),
                                            args.get("attendees")
                                        )
                                        result = {"status": "success", "eventId": event.get("id"), "summary": event.get("summary")}
                                except Exception as err:
                                    result = {"error": str(err)}

                                await websocket.send_json({
                                    "type": "TOOL_LOG",
                                    "tool": name,
                                    "args": args,
                                    "result": result
                                })

                                function_responses.append(types.FunctionResponse(
                                    name=name,
                                    id=call.id,
                                    response=result
                                ))

                            await session.send_tool_response(
                                function_responses=function_responses
                            )

                except (WebSocketDisconnect, asyncio.CancelledError):
                    pass

            await asyncio.gather(receive_from_client(), receive_from_gemini())

    except Exception as e:
        err_msg = str(e)
        if "1008" in err_msg or "bidiGenerateContent" in err_msg or "not found" in err_msg:
            user_err = "Gemini Multimodal Live API (bidiGenerateContent) requires a Billing-Enabled AI Studio Key or Google Cloud project. Please use the STANDARD VAD ENGINE tab for your key."
        else:
            user_err = f"Gemini Live Error: {err_msg}"
        print(f"[Gemini Live Error]: {user_err}")
        try:
            await websocket.send_json({"type": "ERROR", "error": user_err})
            await websocket.close(code=1000)
        except Exception:
            pass
