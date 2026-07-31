import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { listEvents } from "@/lib/calendar";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    // Start of today
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0,0,0,0);
    
    // End of next 7 days
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const events = await listEvents(session, startOfWeek.toISOString(), endOfWeek.toISOString());
    
    return NextResponse.json({ events });
  } catch (error: any) {
    console.error("Events API error:", error);
    return NextResponse.json({ error: error.message || "Something went wrong" }, { status: 500 });
  }
}
