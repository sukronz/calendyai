import os
import time
import datetime
from typing import List, Dict, Any, Optional
from google import genai
from google.genai import types
from google.genai import errors
from services import calendar_service

def get_system_instruction() -> str:
    now = datetime.datetime.now()
    return f"""You are a highly efficient, human-like voice scheduling assistant for Google Calendar.
Your responses are spoken aloud to the user, so they MUST be extremely concise, natural, and conversational. Do not output repetitive responses or long lists. NEVER output markdown like asterisks or bullet points. Keep your final response to one or two short sentences maximum.

CRITICAL CONTEXT:
- The current local date and time is: {now.strftime('%c')} (ISO: {now.isoformat()}). You MUST use this to know the current year, month, date, and day of the week.
- The user is in India Standard Time (IST, UTC+5:30). When calling tools, format ISO strings with +05:30 timezone offset.

RULES FOR SCHEDULING & CLARITY:
1. SMARTER TIME PARSING & RELATIVE TIMES:
   - Understand complex time references using the current date context.
   - For "sometime late next week", target Thursday/Friday of the following week in the afternoon.
   - For "morning of June 20th", target ~10:00 AM on June 20th of the current year.
   - For "an hour before my 5 PM meeting on Friday", use 'list_events' to find the 5 PM meeting on Friday, then target 4:00 PM.
2. VAGUE TIME & EVENING REQUESTS: If the user asks for a meeting without specifying an exact time, DO NOT book immediately. First check for events using 'list_events', then ask the user for clarity and suggest 2-3 specific time options.
3. MANDATORY CONFLICT CHECK: ALWAYS call 'list_events' first to check for clashes before calling 'create_event'.
4. ADVANCED CONFLICT RESOLUTION & FREE SLOT SUGGESTIONS:
   - Inspect start and end times carefully. If requested slot overlaps with an existing event, compute the NEXT EARLIEST TRULY FREE TIME SLOT.
   - If a specific day is heavily booked, suggest the next available day/time block.
5. NO CLASHES & EXACT TIME: Proceed to call 'create_event' once an exact free time is confirmed.
6. DEFAULT TITLE: If no title is given, use "Meeting with [Name]".
7. INVITES: Do not ask for user emails or attendee emails. Just book the event directly."""

TOOLS = [
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
        ),
        types.FunctionDeclaration(
            name="delete_event",
            description="Deletes an existing event from the user's Google Calendar.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "eventId": types.Schema(type="STRING", description="Unique ID of the event to delete")
                },
                required=["eventId"]
            )
        ),
        types.FunctionDeclaration(
            name="update_event",
            description="Updates an existing event on the user's Google Calendar.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "eventId": types.Schema(type="STRING", description="Unique ID of the event"),
                    "title": types.Schema(type="STRING", description="New title"),
                    "startTime": types.Schema(type="STRING", description="New start time (ISO)"),
                    "endTime": types.Schema(type="STRING", description="New end time (ISO)")
                },
                required=["eventId"]
            )
        )
    ])
]

MODEL_CANDIDATES = [
    "gemini-flash-latest",
    "gemini-2.0-flash"
]

def process_chat(
    text: Optional[str], 
    messages: Optional[List[Dict[str, Any]]], 
    access_token: str
) -> Dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is missing")

    client = genai.Client(api_key=api_key)
    config = types.GenerateContentConfig(
        system_instruction=get_system_instruction(),
        tools=TOOLS
    )

    prompt = ""
    if text:
        prompt = text
    elif messages and len(messages) > 0:
        prompt = messages[-1].get("content", "")
    else:
        raise ValueError("No prompt text or messages provided")

    chat = None
    last_error = None

    # Check if a custom model is requested via env, otherwise use ultra-fast candidates
    active_models = [os.getenv("GEMINI_MODEL")] + MODEL_CANDIDATES if os.getenv("GEMINI_MODEL") else MODEL_CANDIDATES

    # Try available model candidates instantly to avoid latency
    for model_name in active_models:
        if not model_name:
            continue
        try:
            chat = client.chats.create(model=model_name, config=config)
            response = chat.send_message(prompt)
            break
        except errors.APIError as err:
            last_error = err
            print(f"[AI Service]: Model {model_name} failed ({err.code}), trying next candidate instantly...")
            continue
        except Exception as err:
            last_error = err
            continue

    if not chat or 'response' not in locals():
        raise ValueError(f"All Gemini models failed. Last error: {str(last_error)}")

    tool_logs = []

    # Handle multi-turn function calls loop
    while response.function_calls:
        for call in response.function_calls:
            name = call.name
            args = dict(call.args) if call.args else {}
            tool_result: Dict[str, Any] = {}

            try:
                if name == "list_events":
                    events = calendar_service.list_events(access_token, args.get("timeMin", ""), args.get("timeMax", ""))
                    tool_result = {"eventsCount": len(events), "events": events}
                elif name == "create_event":
                    event = calendar_service.create_event(
                        access_token, 
                        args.get("title", "Meeting"), 
                        args.get("startTime", ""), 
                        args.get("endTime", ""), 
                        args.get("attendees")
                    )
                    tool_result = {"status": "success", "eventId": event.get("id"), "summary": event.get("summary")}
                elif name == "delete_event":
                    delete_res = calendar_service.delete_event(access_token, args.get("eventId", ""))
                    tool_result = {"status": "success", "result": delete_res}
                elif name == "update_event":
                    event = calendar_service.update_event(
                        access_token, 
                        args.get("eventId", ""), 
                        args.get("title"), 
                        args.get("startTime"), 
                        args.get("endTime"), 
                        args.get("attendees")
                    )
                    tool_result = {"status": "success", "eventId": event.get("id"), "summary": event.get("summary")}
            except Exception as e:
                tool_result = {"error": str(e)}

            tool_logs.append({"tool": name, "args": args, "result": tool_result})
            
            response = chat.send_message(
                types.Part.from_function_response(
                    name=name,
                    response=tool_result
                )
            )

    reply_text = response.text if response.text else "I have processed your request."
    return {"reply": reply_text, "toolLogs": tool_logs}
