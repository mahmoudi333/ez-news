from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
import os
import json

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError("GEMINI_API_KEY is missing from backend/.env")

client = genai.Client(api_key=api_key)
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RewriteRequest(BaseModel):
    title: str
    text: str
    url: str | None = None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/rewrite")
def rewrite(req: RewriteRequest):
    prompt = f"""
Take the following news article text and rewrite it in Gen Z + Gen Alpha.

Requirements:
- Keep the original meaning and key facts 100% accurate (no misinformation).
- Rewrite the tone to sound like a mix of:
  - Twitch
  - TikTok/Gen Z humor
  - casual internet conversation
- Use a wide range of slang naturally (don’t force all in one sentence).
- You MUST incorporate these slang terms where they fit naturally:
  rizz, gyatt, fanum tax, skibidi, sigma, mid, bussin, bet, cap, no cap, it’s giving, main character energy, NPC, cooked, ate, delulu, W, L, finna, ain’t, y’all, on God, fr, deadass, period, slay, shade, tea, sus, lowkey, highkey, bruh, say less, GG, EZ, clutch, throwing, griefing, buff, nerf, OP, AFK, touch grass, we’re so back, it’s over
- Style guidelines:
  - Add reactions like “cuh,” “bro,” “nah,” etc.
  - Use exaggeration and humor (but stay clear and readable)
  - Mix short punchy sentences with occasional longer ones.
- Tone examples:
  - “on god we might be cooked 💀”
  - “nah this is lowkey OP fr fr”
  - “bro really said no cap and meant it”
  - “we’re so back / it’s over”
- Important:
  - Do NOT change names, facts, or events
  - Do NOT make it cringe by overstuffing slang—keep it flowing naturally
- Rewrite the headline too.
- Keep roughly the same number of paragraphs as the original body text.
- Return clean paragraph breaks in the body.

Return ONLY a JSON object with exactly these keys:
- headline
- body

Original headline:
{req.title}

Article text:
{req.text}
"""

    schema = {
        "type": "object",
        "properties": {
            "headline": {"type": "string"},
            "body": {"type": "string"}
        },
        "required": ["headline", "body"],
        "propertyOrdering": ["headline", "body"]
    }

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema,
            temperature=0.9,
        ),
    )

    raw = (response.text or "").strip()
    data = json.loads(raw)

    headline = data.get("headline", "").strip()
    body = data.get("body", "").strip()

    if not headline or not body:
        raise ValueError(f"Incomplete structured output: {raw}")

    return {
        "headline": headline,
        "body": body
    }