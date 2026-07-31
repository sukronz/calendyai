import { google } from "googleapis";
import { Session } from "next-auth";

export async function getCalendarClient(session: Session) {
  // @ts-ignore
  const accessToken = session.accessToken;
  if (!accessToken) {
    throw new Error("No Google access token found in session");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  
  oauth2Client.setCredentials({ access_token: accessToken });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export async function listEvents(session: Session, timeMin: string, timeMax: string) {
  const calendar = await getCalendarClient(session);
  
  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: timeMin,
    timeMax: timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  return response.data.items || [];
}

export async function createEvent(
  session: Session,
  title: string,
  startTime: string,
  endTime: string,
  attendees?: string[]
) {
  const calendar = await getCalendarClient(session);
  
  const event = {
    summary: title,
    start: {
      dateTime: startTime,
    },
    end: {
      dateTime: endTime,
    },
    attendees: attendees ? attendees.map(email => ({ email })) : undefined,
  };

  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: event,
    sendUpdates: "all",
  });

  return response.data;
}
