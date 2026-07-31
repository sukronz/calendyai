import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { listEvents, createEvent } from "@/lib/calendar";
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

const systemInstruction = `You are a helpful AI scheduling assistant. 
Your goal is to help users manage their calendar by scheduling meetings and checking availability.

CRITICAL CONTEXT:
- The current local date and time is: ${new Date().toString()} (ISO: ${new Date().toISOString()}) the user will give instructions in india standartd time and use that only.
- You MUST use this exact date and time as the baseline for ALL relative time calculations (e.g., "next week", "tomorrow at 4pm").

RULES FOR SCHEDULING (STRICT WORKFLOW):
1. MANDATORY CONFLICT CHECK: BEFORE calling 'create_event', you MUST ALWAYS call 'list_events' for the exact time window requested to check if there are any existing meetings.
2. RESOLVING CLASHES: If the 'list_events' tool reveals an existing meeting during the requested time, DO NOT schedule the new meeting yet. Instead, inform the user (e.g., "There is already a '[Existing Meeting Title]' scheduled at that time.") and ask them which meeting they want to shift.
3. CLEAR TO SCHEDULE: If 'list_events' shows no clashes (the time slot is empty), you may proceed to call 'create_event'.
4. DEFAULT TITLE: If the user does NOT explicitly provide a meeting title, you MUST automatically generate one in the format "Meeting with [Person Name]". For example, if the request is "Schedule a meeting with Sara for next week 4pm", the title should be "Meeting with Sara".
5. Be conversational, brief, and helpful.
6. Also ask the user if they want to send an invite to the user email id, do not send invtes automatically`;

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

    const history = previousMessages.map((msg: any) => ({
      role: msg.role === "agent" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    // Gemini requires the first message in history to be from the user.
    if (history.length > 0 && history[0].role === "model") {
      history.unshift({ role: "user", parts: [{ text: "Hello" }] });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{ functionDeclarations: [listEventsFunction, createEventFunction] }],
      systemInstruction: systemInstruction,
    });

    const chat = model.startChat({
      history: history,
    });

    // Send the user's latest message
    let result = await chat.sendMessage([{ text: latestMessage }]);

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
          functionResult = { events };
        } else if (call.name === "create_event") {
          const args = call.args as any;
          const event = await createEvent(session, args.title, args.startTime, args.endTime, args.attendees);
          functionResult = { status: "success", event };
        } else {
          functionResult = { error: "Unknown function" };
        }
      } catch (err: any) {
        console.error(`[Gemini] Function ${call.name} error:`, err.message);
        functionResult = { error: err.message };
      }

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

    return NextResponse.json({ reply: replyText });
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
