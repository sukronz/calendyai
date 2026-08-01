import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { listEvents, createEvent, deleteEvent, updateEvent } from "@/lib/calendar";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const listEventsFunction: FunctionDeclaration = {
  name: "list_events",
  description: "Lists upcoming calendar events for the user between a start and end time.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      timeMin: {
        type: SchemaType.STRING,
        description: "The start of the time range to query in ISO string format, e.g. 2026-08-01T10:00:00Z",
      },
      timeMax: {
        type: SchemaType.STRING,
        description: "The end of the time range to query in ISO string format, e.g. 2026-08-01T20:00:00Z",
      },
    },
    required: ["timeMin", "timeMax"],
  },
};

const createEventFunction: FunctionDeclaration = {
  name: "create_event",
  description: "Schedules a new meeting or event on the user's Google Calendar.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      title: {
        type: SchemaType.STRING,
        description: "The title of the meeting or event.",
      },
      startTime: {
        type: SchemaType.STRING,
        description: "The start time of the event in ISO string format, e.g. 2026-08-01T10:00:00Z",
      },
      endTime: {
        type: SchemaType.STRING,
        description: "The end time of the event in ISO string format, e.g. 2026-08-01T11:00:00Z",
      },
      attendees: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: "Optional array of email addresses to invite.",
      },
    },
    required: ["title", "startTime", "endTime"],
  },
};

const deleteEventFunction: FunctionDeclaration = {
  name: "delete_event",
  description: "Deletes an existing event from the user's Google Calendar.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      eventId: {
        type: SchemaType.STRING,
        description: "The unique ID of the event to delete. You must call list_events first to find this ID.",
      },
    },
    required: ["eventId"],
  },
};

const updateEventFunction: FunctionDeclaration = {
  name: "update_event",
  description: "Updates an existing event on the user's Google Calendar.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      eventId: {
        type: SchemaType.STRING,
        description: "The unique ID of the event to update. You must call list_events first to find this ID.",
      },
      title: {
        type: SchemaType.STRING,
        description: "The new title of the event (optional).",
      },
      startTime: {
        type: SchemaType.STRING,
        description: "The new start time of the event in ISO format (optional).",
      },
      endTime: {
        type: SchemaType.STRING,
        description: "The new end time of the event in ISO format (optional).",
      },
    },
    required: ["eventId"],
  },
};

const systemInstruction = `You are a highly efficient, human-like voice scheduling assistant.
Your responses are spoken aloud to the user, so they MUST be extremely concise, natural, and conversational. Do not output repetitive responses or long lists. NEVER output markdown like asterisks or bullet points. Keep your final response to one or two short sentences maximum.

CRITICAL CONTEXT:
- The current local date and time is: ${new Date().toString()} (ISO: ${new Date().toISOString()}). You MUST use this to know the current year, month, date, and day of the week.
- The user is in India Standard Time (IST, UTC+5:30). When calling tools, you MUST format all ISO strings with the +05:30 timezone offset instead of Z. For example, for 3:00 PM IST, output "YYYY-MM-DDT15:00:00+05:30".

RULES FOR SCHEDULING & CLARITY:
1. SMARTER TIME PARSING & RELATIVE TIMES:
   - Understand complex time references using the current date context.
   - For "sometime late next week", target Thursday/Friday of the following week in the afternoon.
   - For "morning of June 20th", target ~10:00 AM on June 20th of the current year.
   - For "an hour before my 5 PM meeting on Friday", use 'list_events' to find the 5 PM meeting on Friday, then target 4:00 PM.
2. VAGUE TIME & EVENING REQUESTS: If the user asks for a meeting without specifying an exact time (e.g. "book an evening meeting", "schedule something in the morning"), DO NOT book immediately. First check for events using 'list_events', then ask the user for clarity and suggest 2-3 specific time options.
   - For evening requests, explicitly offer options after 5:30 PM, such as "5:30 PM, 6:00 PM, or 6:30 PM".
3. MANDATORY CONFLICT CHECK: ALWAYS call 'list_events' first to check for clashes before calling 'create_event'.
4. ADVANCED CONFLICT RESOLUTION & FREE SLOT SUGGESTIONS:
   - When 'list_events' returns existing events, inspect their start and end times carefully.
   - If the requested time slot overlaps with an existing event (e.g., an existing meeting from 9:00 AM to 9:00 PM), NEVER suggest an alternative time that falls INSIDE the start and end range of ANY existing event!
   - You MUST compute the NEXT EARLIEST TRULY FREE TIME SLOT that has zero overlap (e.g. 9:00 PM tonight after the 9 AM-9 PM meeting ends, or 9:00 AM the next morning).
   - If a specific day is heavily or fully booked (e.g. Tuesday afternoon), handle it gracefully without failing. Suggest the next available day/time block.
   - Example response: "Tuesday afternoon is fully booked. Would Wednesday morning work instead, perhaps around 10 AM?"
5. NO CLASHES & EXACT TIME: Proceed to call 'create_event' once an exact free time is confirmed.
6. DEFAULT TITLE: If no title is given, use "Meeting with [Name]".
7. INVITES: Do not ask for user emails or attendee emails. Just book the event directly.
8. NO REPETITION: Do not repeat yourself or send multiple similar sentences. Combine your thoughts into a single, short, human-like response.`;

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Invalid messages array" }, { status: 400 });
    }

    const latestMessage = messages[messages.length - 1].content;
    const previousMessages = messages.slice(0, -1);

    // Strictly sanitize history roles to only 'user' or 'model'
    const history = previousMessages
      .filter((msg: any) => msg.role === "user" || msg.role === "agent")
      .map((msg: any) => ({
        role: msg.role === "agent" ? "model" : "user",
        parts: [{ text: String(msg.content) }]
      }));

    // Gemini requires the first message in history to be from the user.
    if (history.length > 0 && history[0].role === "model") {
      history.unshift({ role: "user", parts: [{ text: "Hello" }] });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-3.1-flash-lite",
      tools: [{ functionDeclarations: [listEventsFunction, createEventFunction, deleteEventFunction, updateEventFunction] }],
      systemInstruction: systemInstruction,
    });

    const chat = model.startChat({
      history: history,
    });

    // Send the user's latest message
    let result = await chat.sendMessage([{ text: latestMessage }]);

    const toolLogs: { tool: string; args: any; result: any; timestamp: string }[] = [];

    // Check if the model wants to call a function
    let calls = result.response.functionCalls();
    while (calls && calls.length > 0) {
      const call = calls[0];
      console.log("[Gemini] Function Call Triggered:", call.name, call.args);

      let functionResult = {};
      try {
        if (call.name === "list_events") {
          const args = call.args as any;
          const events = await listEvents(session, args.timeMin, args.timeMax);
          functionResult = { eventsCount: events.length, events };
        } else if (call.name === "create_event") {
          const args = call.args as any;
          const event = await createEvent(session, args.title, args.startTime, args.endTime, args.attendees);
          functionResult = { status: "success", eventId: event.id, summary: event.summary };
        } else if (call.name === "delete_event") {
          const args = call.args as any;
          const result = await deleteEvent(session, args.eventId);
          functionResult = { status: "success", result };
        } else if (call.name === "update_event") {
          const args = call.args as any;
          const event = await updateEvent(session, args.eventId, args.title, args.startTime, args.endTime, args.attendees);
          functionResult = { status: "success", eventId: event.id, summary: event.summary };
        } else {
          functionResult = { error: "Unknown function" };
        }
      } catch (err: any) {
        console.error(`[Gemini] Function ${call.name} error:`, err.message);
        functionResult = { error: err.message };
      }

      toolLogs.push({
        tool: call.name,
        args: call.args,
        result: functionResult,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      });

      console.log(`[Gemini] Sending function response back:`, functionResult);

      // Send the function response back to the model
      result = await chat.sendMessage([{
        functionResponse: {
          name: call.name,
          response: functionResult,
        }
      }]);
      calls = result.response.functionCalls();
    }

    let replyText = "";
    try {
      replyText = result.response.text();
    } catch (e) {
      console.warn("[Gemini] Could not extract text from response:", e);
    }

    if (!replyText || replyText.trim() === "") {
      replyText = "I processed your request, but encountered an unexpected empty response from the AI. Check the server console for details.";
      console.log("[Gemini] Empty response received. Full response object:", JSON.stringify(result.response, null, 2));
    }

    return NextResponse.json({ reply: replyText, toolLogs });
  } catch (error: any) {
    console.error("Chat API error:", error);

    if (error.status === 429 || error.message?.includes("429") || error.message?.includes("Too Many Requests")) {
      return NextResponse.json({
        reply: "I am receiving too many requests right now! You've hit the Gemini API rate limit. Please wait about a minute before trying again."
      });
    }

    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}
