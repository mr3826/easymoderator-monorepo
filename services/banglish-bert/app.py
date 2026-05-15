"""
BanglaBERT Intent Classifier Microservice

Classifies Banglish/Bengali F-commerce messages into intents using
a fine-tunable multilingual BERT model (sagorsarker/bangla-bert-base
or csebuetnlp/banglabert as primary; falls back to regex heuristics
when the model is not loaded).

POST /classify
  Body: { "text": "bhaiya eita available ache?", "shop_id": "..." }
  Returns: { "intents": [...], "primaryIntent": "...", "confidence": 0.92, "model": "bert|heuristic" }

POST /batch_classify
  Body: { "messages": [{ "id": "...", "text": "..." }] }
  Returns: { "results": [{ "id": "...", "intents": [...], ... }] }

GET /health
  Returns: { "status": "ok", "model_loaded": true|false }

Environment variables:
  MODEL_NAME   HuggingFace model id (default: sagorsarker/bangla-bert-base)
  DEVICE       cpu | cuda (default: cpu)
  PORT         (default: 8001)
"""

import os
import re
import json
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="BanglaBERT Intent Classifier", version="1.0.0")

MODEL_NAME = os.getenv("MODEL_NAME", "sagorsarker/bangla-bert-base")
DEVICE = os.getenv("DEVICE", "cpu")
PORT = int(os.getenv("PORT", "8001"))

# ---------------------------------------------------------------------------
# Intent labels (shared with Node.js BanglishNormalizer)
# ---------------------------------------------------------------------------
INTENT_LABELS = [
    "availability_query",
    "price_query",
    "order_intent",
    "size_query",
    "payment_intent",
    "delivery_query",
    "return_query",
    "greeting",
    "other"
]

# ---------------------------------------------------------------------------
# Heuristic fallback (mirrors banglish-normalizer.service.js logic)
# ---------------------------------------------------------------------------
HEURISTIC_PATTERNS = [
    ("availability_query", [r"\b(available|ache|ase|stock|pabo)\b", r"আছে|পাওয়া"]),
    ("price_query",        [r"\b(koto|daam|dam|price|rate|taka|cost)\b", r"কত|দাম|টাকা|মূল্য"]),
    ("order_intent",       [r"\b(order|nibo|buy|kinbo|booking)\b", r"নিব|কিনব|নেব"]),
    ("size_query",         [r"\b(size|fitting|fit|xl|xxl|small|medium|large)\b", r"সাইজ|মাপ"]),
    ("payment_intent",     [r"\b(bkash|nagad|rocket|cod|cash|payment)\b", r"বিকাশ|নগদ|রকেট"]),
    ("delivery_query",     [r"\b(delivery|courier|shipping|dispatch)\b", r"ডেলিভারি|কুরিয়ার"]),
    ("return_query",       [r"\b(return|exchange|refund|ferot|bodol)\b", r"রিটার্ন|ফেরত|বদল"]),
    ("greeting",           [r"^(hi|hello|hey|assalam|salam|bhai|vai|apu)\b", r"^(ভাই|আপু|দাদা)"]),
]


def heuristic_classify(text: str) -> dict:
    text_lower = text.lower().strip()
    intents = []
    for intent, patterns in HEURISTIC_PATTERNS:
        for pattern in patterns:
            try:
                if re.search(pattern, text_lower):
                    intents.append(intent)
                    break
            except re.error:
                pass
    return {
        "intents": intents,
        "primaryIntent": intents[0] if intents else "other",
        "confidence": 0.65,
        "model": "heuristic"
    }


# ---------------------------------------------------------------------------
# BERT model (lazy-loaded at startup)
# ---------------------------------------------------------------------------
_pipeline = None


def load_model():
    global _pipeline
    try:
        from transformers import pipeline as hf_pipeline
        logger.info(f"Loading model: {MODEL_NAME} on {DEVICE}")
        _pipeline = hf_pipeline(
            "text-classification",
            model=MODEL_NAME,
            device=0 if DEVICE == "cuda" else -1,
            top_k=None
        )
        logger.info("Model loaded successfully")
    except Exception as e:
        logger.warning(f"Model load failed ({e}), falling back to heuristics")
        _pipeline = None


def bert_classify(text: str) -> dict:
    if _pipeline is None:
        return None
    try:
        results = _pipeline(text[:512], top_k=None)
        # results is a list of {"label": ..., "score": ...}
        sorted_results = sorted(results, key=lambda x: x["score"], reverse=True)
        top = sorted_results[0]
        intents = [r["label"] for r in sorted_results if r["score"] > 0.2]
        return {
            "intents": intents[:3],
            "primaryIntent": top["label"],
            "confidence": round(top["score"], 4),
            "model": "bert"
        }
    except Exception as e:
        logger.error(f"BERT inference error: {e}")
        return None


# ---------------------------------------------------------------------------
# FastAPI routes
# ---------------------------------------------------------------------------

class ClassifyRequest(BaseModel):
    text: str
    shop_id: Optional[str] = None


class BatchMessage(BaseModel):
    id: str
    text: str


class BatchClassifyRequest(BaseModel):
    messages: list[BatchMessage]


@app.on_event("startup")
async def startup_event():
    load_model()


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _pipeline is not None, "model": MODEL_NAME}


@app.post("/classify")
def classify(req: ClassifyRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    result = bert_classify(req.text)
    if result is None:
        result = heuristic_classify(req.text)

    return result


@app.post("/batch_classify")
def batch_classify(req: BatchClassifyRequest):
    results = []
    for msg in req.messages:
        result = bert_classify(msg.text)
        if result is None:
            result = heuristic_classify(msg.text)
        results.append({"id": msg.id, **result})
    return {"results": results}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
