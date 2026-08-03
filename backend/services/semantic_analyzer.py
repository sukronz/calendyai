import re

INCOMPLETE_TRAILING_WORDS = {
    "a", "an", "the", "and", "or", "but", "if", "with", "on", "at", "to", "for", "from",
    "by", "about", "around", "of", "in", "is", "are", "was", "were", "my", "your",
    "some", "any", "that", "this", "schedule", "book", "create", "delete", "cancel", "check"
}

COMPLETE_PHRASES = {
    "yes", "no", "sure", "okay", "ok", "yep", "nope", "that works", "sounds good", "thanks", "thank you"
}

def is_complete_thought(transcript: str) -> bool:
    """Analyzes a partial speech transcript to determine if it represents a complete thought.
    Returns True if complete, False if incomplete.
    """
    clean_text = transcript.strip().lower()
    if not clean_text:
        return False

    # Immediate match for short complete affirmations/negations
    if clean_text in COMPLETE_PHRASES:
        return True

    words = re.findall(r'\w+', clean_text)
    if not words:
        return False

    last_word = words[-1]

    # If the sentence ends with a conjunction, preposition, or article, it is incomplete
    if last_word in INCOMPLETE_TRAILING_WORDS:
        return False

    # Short single-word non-affirmation utterance (e.g. "meeting", "the") is likely incomplete
    if len(words) == 1 and last_word not in COMPLETE_PHRASES:
        return False

    # If the transcript contains a complete intent structure (action + subject/time), it's complete
    # e.g., "list my events", "schedule meeting with alex at 5 pm"
    if len(words) >= 3:
        return True

    return True
