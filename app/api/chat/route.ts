import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || "http://localhost:8000";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(session as any).accessToken) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const body = await req.json();
    const accessToken = (session as any).accessToken;

    const backendRes = await fetch(`${PYTHON_BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: body.text,
        messages: body.messages,
        accessToken,
      }),
    });

    if (!backendRes.ok) {
      const errorData = await backendRes.json().catch(() => ({ detail: "Python AI service unavailable" }));
      return new Response(
        JSON.stringify({ error: errorData.detail || "Error from Python AI backend" }),
        { status: backendRes.status }
      );
    }

    const data = await backendRes.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[Next.js Chat API Proxy Error]:", error);
    return new Response(
      JSON.stringify({ 
        error: "Failed to communicate with Python AI backend. Please ensure the backend is running on port 8000." 
      }),
      { status: 500 }
    );
  }
}

