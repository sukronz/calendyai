import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { listEvents, createEvent, deleteEvent, updateEvent } from "@/lib/calendar";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const systemInstruction = `You are a highly efficient, human-like voice scheduling assistant for Google Calendar.
Your responses are spoken aloud to the user, so they MUST be extremely concise, natural, and conversational. Do not output repetitive responses or long lists. NEVER output markdown like asterisks or bullet points. Keep your final response to one or two short sentences maximum.

CRITICAL CONTEXT:
- The current local date and time is: ${new Date().toString()} (ISO: ${new Date().toISOString()}). You MUST use this to know the current year, month, date, and day of the week.
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
7. INVITES: Do not ask for user emails or attendee emails. Just book the event directly.`;

const tools: any = [
  {
    functionDeclarations: [
      {
        name: "list_events",
        description: "Lists upcoming calendar events for the user between a start and end time.",
        parameters: {
          type: "OBJECT",
          properties: {
            timeMin: { type: "STRING", description: "Start of time range (ISO string)" },
            timeMax: { type: "STRING", description: "End of time range (ISO string)" }
          },
          required: ["timeMin", "timeMax"]
        }
      },
      {
        name: "create_event",
        description: "Schedules a new meeting or event on the user's Google Calendar.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Title of the meeting" },
            startTime: { type: "STRING", description: "Start time in ISO format" },
            endTime: { type: "STRING", description: "End time in ISO format" },
            attendees: { type: "ARRAY", items: { type: "STRING" }, description: "Optional attendee emails" }
          },
          required: ["title", "startTime", "endTime"]
        }
      },
      {
        name: "delete_event",
        description: "Deletes an existing event from the user's Google Calendar.",
        parameters: {
          type: "OBJECT",
          properties: {
            eventId: { type: "STRING", description: "Unique ID of the event to delete" }
          },
          required: ["eventId"]
        }
      },
      {
        name: "update_event",
        description: "Updates an existing event on the user's Google Calendar.",
        parameters: {
          type: "OBJECT",
          properties: {
            eventId: { type: "STRING", description: "Unique ID of the event" },
            title: { type: "STRING", description: "New title" },
            startTime: { type: "STRING", description: "New start time (ISO)" },
            endTime: { type: "STRING", description: "New end time (ISO)" }
          },
          required: ["eventId"]
        }
      }
    ]
  }
];

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await req.json();
    let contents: any[] = [];

    if (body.text) {
      contents.push({ text: body.text });
    } else if (body.messages) {
      contents = body.messages.map((m: any) => ({
        role: m.role === "agent" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
    } else {
      return new Response(JSON.stringify({ error: "No text input provided" }), { status: 400 });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash-lite",
      systemInstruction,
      tools
    });

    const toolLogs: any[] = [];
    const chat = model.startChat();

    let result = await chat.sendMessage(contents);
    let response = await result.response;

    // Handle tool calls in a loop
    while (response.functionCalls() && response.functionCalls()!.length > 0) {
      const calls = response.functionCalls()!;
      const functionResponses: any[] = [];

      for (const call of calls) {
        const { name, args } = call;
        let toolResult: any = {};

        try {
          if (name === "list_events") {
            const events = await listEvents(session, (args as any).timeMin, (args as any).timeMax);
            toolResult = { eventsCount: events.length, events };
          } else if (name === "create_event") {
            const event = await createEvent(session, (args as any).title, (args as any).startTime, (args as any).endTime, (args as any).attendees);
            toolResult = { status: "success", eventId: event.id, summary: event.summary };
          } else if (name === "delete_event") {
            const deleteRes = await deleteEvent(session, (args as any).eventId);
            toolResult = { status: "success", result: deleteRes };
          } else if (name === "update_event") {
            const event = await updateEvent(session, (args as any).eventId, (args as any).title, (args as any).startTime, (args as any).endTime, (args as any).attendees);
            toolResult = { status: "success", eventId: event.id, summary: event.summary };
          }
        } catch (err: any) {
          toolResult = { error: err.message };
        }

        toolLogs.push({ tool: name, args, result: toolResult });
        functionResponses.push({
          response: { name, response: toolResult }
        });
      }

      const res = await chat.sendMessage(functionResponses);
      response = await res.response;
    }

    const reply = response.text() || "I have processed your request.";

    return new Response(JSON.stringify({ reply, toolLogs }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("[Chat API Error]:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
