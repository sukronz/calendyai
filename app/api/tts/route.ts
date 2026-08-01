import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    // Default to the GEMINI_API_KEY if GOOGLE_API_KEY isn't specifically set
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "en-US", name: "en-US-Journey-F" }, // High quality Google Journey voice
        audioConfig: { audioEncoding: "OGG_OPUS" }
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const audioBuffer = Buffer.from(data.audioContent, 'base64');

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/ogg",
      },
    });
  } catch (error: any) {
    console.error("Google TTS error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
