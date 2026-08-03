import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { NextResponse } from "next/server";
import { listEvents, createEvent, deleteEvent, updateEvent } from "@/lib/calendar";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, args } = body;

    if (!name) {
      return NextResponse.json({ error: "Tool name missing" }, { status: 400 });
    }

    let result = {};
    try {
      if (name === "list_events") {
        const events = await listEvents(session, args.timeMin, args.timeMax);
        result = { eventsCount: events.length, events };
      } else if (name === "create_event") {
        const event = await createEvent(session, args.title, args.startTime, args.endTime, args.attendees);
        result = { status: "success", eventId: event.id, summary: event.summary };
      } else if (name === "delete_event") {
        const deleteRes = await deleteEvent(session, args.eventId);
        result = { status: "success", result: deleteRes };
      } else if (name === "update_event") {
        const event = await updateEvent(session, args.eventId, args.title, args.startTime, args.endTime, args.attendees);
        result = { status: "success", eventId: event.id, summary: event.summary };
      } else {
        result = { error: "Unknown tool" };
      }
    } catch (err: any) {
      console.error(`[Tools API] Error executing ${name}:`, err.message);
      result = { error: err.message };
    }

    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
