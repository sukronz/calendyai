from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from typing import List, Optional, Dict, Any

def get_calendar_service(access_token: str):
    """Builds and returns a Google Calendar service using the user's OAuth access token."""
    credentials = Credentials(token=access_token)
    return build("calendar", "v3", credentials=credentials)

def list_events(access_token: str, time_min: str, time_max: str) -> List[Dict[str, Any]]:
    """Lists upcoming calendar events between time_min and time_max (ISO 8601 strings)."""
    service = get_calendar_service(access_token)
    events_result = service.events().list(
        calendarId="primary",
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime"
    ).execute()
    return events_result.get("items", [])

def create_event(
    access_token: str, 
    title: str, 
    start_time: str, 
    end_time: str, 
    attendees: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Schedules a new meeting or event on the user's Google Calendar."""
    service = get_calendar_service(access_token)
    event_body: Dict[str, Any] = {
        "summary": title,
        "start": {"dateTime": start_time},
        "end": {"dateTime": end_time},
    }
    if attendees:
        event_body["attendees"] = [{"email": email} for email in attendees]

    return service.events().insert(
        calendarId="primary",
        body=event_body,
        sendUpdates="all"
    ).execute()

def delete_event(access_token: str, event_id: str) -> Dict[str, Any]:
    """Deletes an existing event from the user's Google Calendar."""
    service = get_calendar_service(access_token)
    service.events().delete(
        calendarId="primary",
        eventId=event_id,
        sendUpdates="all"
    ).execute()
    return {"status": "deleted", "eventId": event_id}

def update_event(
    access_token: str,
    event_id: str,
    title: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    attendees: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Updates an existing event on the user's Google Calendar."""
    service = get_calendar_service(access_token)
    event_patch: Dict[str, Any] = {}
    if title:
        event_patch["summary"] = title
    if start_time:
        event_patch["start"] = {"dateTime": start_time}
    if end_time:
        event_patch["end"] = {"dateTime": end_time}
    if attendees:
        event_patch["attendees"] = [{"email": email} for email in attendees]

    return service.events().patch(
        calendarId="primary",
        eventId=event_id,
        body=event_patch,
        sendUpdates="all"
    ).execute()
