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

    from services.ai_service import get_system_instruction

    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        system_instruction=types.Content(parts=[types.Part.from_text(text=get_system_instruction())]),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Kore")
            )
        ),
        tools=LIVE_TOOLS
    )

    while True:
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
                                print(f"[Gemini Live] Relaying {len(pcm_data)} bytes client audio -> Gemini")
                                await session.send_realtime_input(
                                    audio=types.Blob(data=pcm_data, mime_type="audio/pcm")
                                )
                            elif "text" in msg and msg["text"]:
                                data = json.loads(msg["text"])
                                if data.get("type") == "TEXT_PROMPT":
                                    text_prompt = data.get("prompt", "")
                                    print(f"[Gemini Live] Sending text prompt: '{text_prompt}'")
                                    await session.send_client_content(
                                        turns=[types.Content(parts=[types.Part.from_text(text=text_prompt)])],
                                        turn_complete=True
                                    )
                                elif data.get("type") == "PING":
                                    await websocket.send_json({"type": "PONG"})
                    except (WebSocketDisconnect, asyncio.CancelledError):
                        print("[Gemini Live] Client WebSocket disconnected (Client loop closed).")
                        raise

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
                                            print(f"[Gemini Live] Relaying {len(part.inline_data.data)} bytes audio response -> Client")
                                            await websocket.send_bytes(part.inline_data.data)
                                        elif part.text:
                                            print(f"[Gemini Live] Model text output: {part.text}")
                                            await websocket.send_json({
                                                "type": "TEXT_CHUNK",
                                                "text": part.text
                                            })

                                if server_content.turn_complete:
                                    print("[Gemini Live] Model Turn Complete.")
                                    await websocket.send_json({"type": "TURN_COMPLETE"})

                            tool_call = response.tool_call
                            if tool_call:
                                function_responses = []
                                for call in tool_call.function_calls:
                                    name = call.name
                                    args = dict(call.args) if call.args else {}
                                    print(f"[Gemini Live] Tool call request: {name}({args})")
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

                                    print(f"[Gemini Live] Tool output result: {result}")
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
                        print("[Gemini Live] Client WebSocket disconnected (Gemini loop closed).")
                        raise

                # Run client loop and Gemini loop concurrently; cancel sibling cleanly on disconnect
                tasks = [
                    asyncio.create_task(receive_from_client()),
                    asyncio.create_task(receive_from_gemini())
                ]
                try:
                    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for task in pending:
                        task.cancel()
                        
                    client_disconnected = False
                    for task in done:
                        try:
                            task.result()
                        except WebSocketDisconnect:
                            client_disconnected = True
                        except Exception as e:
                            if "disconnect" in str(e).lower() or "close" in str(e).lower():
                                client_disconnected = True
                                
                    if client_disconnected:
                        print("[Gemini Live] Client disconnected. Exiting outer loop.")
                        break
                    else:
                        print("[Gemini Live] Gemini session ended. Reconnecting in 1s...")
                        await asyncio.sleep(1)
                except Exception:
                    pass

        except (WebSocketDisconnect, asyncio.CancelledError):
            print("[Gemini Live] Session closed by client disconnect.")
            break
        except Exception as e:
            err_msg = str(e)
            if "disconnect" in err_msg.lower():
                print("[Gemini Live] Session closed by client disconnect.")
                break

            if "1008" in err_msg or "bidigeneratecontent" in err_msg.lower() or "not found" in err_msg.lower():
                user_err = "Gemini Multimodal Live API (bidiGenerateContent) requires a Billing-Enabled AI Studio Key or Google Cloud project."
                print(f"[Gemini Live Error]: {user_err}")
                try:
                    await websocket.send_json({"type": "ERROR", "error": user_err})
                    await websocket.close(code=1000)
                except Exception:
                    pass
                break
            else:
                print(f"[Gemini Live] Session dropped with error: {err_msg}. Reconnecting in 2s...")
                await asyncio.sleep(2)
