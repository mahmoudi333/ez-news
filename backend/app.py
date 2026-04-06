from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
import os
import json
import traceback

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError("GEMINI_API_KEY is missing from environment variables")

client = genai.Client(api_key=api_key)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RewriteRequest(BaseModel):
    title: str
    text: str
    url: str | None = None


@app.get("/")
def root():
    return {"ok": True, "message": "EZ News backend is running"}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/rewrite")
def rewrite(req: RewriteRequest):
    try:
        if not req.title and not req.text:
            raise HTTPException(status_code=400, detail="Missing article title and text")

        article_title = (req.title or "").strip()
        article_text = (req.text or "").strip()

        if not article_text:
            raise HTTPException(status_code=400, detail="Missing article text")

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
  - Use exaggeration and humor, but stay clear and readable.
  - Mix short punchy sentences with occasional longer ones.
- Tone examples:
  - “on god we might be cooked 💀”
  - “nah this is lowkey OP fr fr”
  - “bro really said no cap and meant it”
  - “we’re so back / it’s over”
- Important:
  - Do NOT change names, facts, dates, prices, numbers, or events.
  - Do NOT make it cringe by overstuffing slang — keep it flowing naturally.
- Rewrite the headline too.
- Keep roughly the same number of paragraphs as the original body text.
- Return clean paragraph breaks in the body.
- If the body text is short or incomplete, still rewrite whatever is provided.
- Return ONLY valid JSON in this exact shape:
{{
  "headline": "rewritten headline here",
  "body": "rewritten article body here"
}}

Original headline:
{article_title}

Article text:
{article_text}
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
        if not raw:
            raise HTTPException(status_code=500, detail="Gemini returned empty output")

        try:
            data = json.loads(raw)
        except Exception as json_error:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to parse Gemini JSON output: {str(json_error)} | Raw: {raw[:500]}"
            )

        headline = str(data.get("headline", "")).strip()
        body = str(data.get("body", "")).strip()

        if not headline:
            headline = article_title or "Rewritten headline"

        if not body:
            raise HTTPException(status_code=500, detail="Gemini returned empty body")

        return {
            "headline": headline,
            "body": body
        }

    except HTTPException:
        raise
    except Exception as e:
        print("==== /rewrite ERROR START ====")
        print(str(e))
        traceback.print_exc()
        print("==== /rewrite ERROR END ====")
        raise HTTPException(status_code=500, detail=f"Server error: {str(e)}")