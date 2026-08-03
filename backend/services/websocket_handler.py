import json
import asyncio
from fastapi import WebSocket, WebSocketDisconnect
from services.turn_detector import TurnDetectionHandler
from services.semantic_analyzer import is_complete_thought
from services import ai_service

async def handle_voice_websocket(websocket: WebSocket):
    await websocket.accept()
    turn_detector = TurnDetectionHandler(silence_threshold_db=-45.0, min_speech_ms=120)
    
    last_transcript = ""
    access_token = ""
    is_processing_turn = False

    try:
        while True:
            message = await websocket.receive()
            
            # Handle binary PCM audio frames (640 bytes per 20ms frame)
            if "bytes" in message and message["bytes"]:
                pcm_chunk = message["bytes"]
                is_barge_in = turn_detector.process_audio_frame(pcm_chunk)
                
                if is_barge_in and is_processing_turn:
                    # User interrupted the AI! Send immediate cancel signal to client
                    await websocket.send_json({
                        "type": "INTERRUPT",
                        "message": "User barge-in detected. Halting agent speech."
                    })
                    is_processing_turn = False

            # Handle JSON control and transcript messages
            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    msg_type = payload.get("type")

                    if msg_type == "INIT":
                        access_token = payload.get("accessToken", "")
                        await websocket.send_json({"type": "READY"})

                    elif msg_type == "PARTIAL_TRANSCRIPT":
                        last_transcript = payload.get("transcript", "")
                        token = payload.get("accessToken") or access_token
                        
                        complete = is_complete_thought(last_transcript)
                        silence_ms = turn_detector.get_silence_duration_ms()

                        # Evaluate Turn-Taking Decision Rules:
                        # 1. Complete thought + silence >= 300ms -> Immediate turn trigger
                        # 2. Incomplete thought -> Wait for longer silence (>= 1500ms)
                        should_trigger_turn = (
                            (complete and silence_ms >= 300) or 
                            (not complete and silence_ms >= 1500)
                        )

                        if should_trigger_turn and last_transcript.strip() and not is_processing_turn:
                            is_processing_turn = True
                            await websocket.send_json({
                                "type": "TURN_DETECTED",
                                "completeThought": complete,
                                "silenceMs": silence_ms,
                                "transcript": last_transcript
                            })

                            # Execute Gemini agent
                            try:
                                result = ai_service.process_chat(
                                    text=last_transcript,
                                    messages=None,
                                    access_token=token
                                )
                                await websocket.send_json({
                                    "type": "AGENT_RESPONSE",
                                    "reply": result.get("reply"),
                                    "toolLogs": result.get("toolLogs", [])
                                })
                            except Exception as err:
                                await websocket.send_json({
                                    "type": "ERROR",
                                    "error": str(err)
                                })
                            finally:
                                is_processing_turn = False
                                turn_detector.reset()

                    elif msg_type == "FORCE_SUBMIT":
                        last_transcript = payload.get("transcript", "")
                        token = payload.get("accessToken") or access_token
                        if last_transcript.strip():
                            is_processing_turn = True
                            try:
                                result = ai_service.process_chat(
                                    text=last_transcript,
                                    messages=None,
                                    access_token=token
                                )
                                await websocket.send_json({
                                    "type": "AGENT_RESPONSE",
                                    "reply": result.get("reply"),
                                    "toolLogs": result.get("toolLogs", [])
                                })
                            except Exception as err:
                                await websocket.send_json({"type": "ERROR", "error": str(err)})
                            finally:
                                is_processing_turn = False
                                turn_detector.reset()

                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WebSocket Voice Error]: {e}")
