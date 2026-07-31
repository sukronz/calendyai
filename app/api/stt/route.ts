import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');

    // Default to the GEMINI_API_KEY if GOOGLE_API_KEY isn't specifically set
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

    const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        config: {
          encoding: "WEBM_OPUS",
          languageCode: "en-US",
        },
        audio: {
          content: base64Audio
        }
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const text = data.results?.map((r: any) => r.alternatives[0].transcript).join('\n') || "";

    return NextResponse.json({ text });
  } catch (error: any) {
    console.error("Google STT error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
