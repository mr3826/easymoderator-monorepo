"""
CLIP Image Similarity Microservice

Provides product-image matching using OpenAI CLIP embeddings.
This is Tier 1 of the ImageProductMatcher pipeline (fastest, ~10ms after warmup).

POST /embed_image
  Body: { "image_url": "https://..." }
  Returns: { "embedding": [...768 floats...], "model": "clip-vit-base-patch32" }

POST /embed_text
  Body: { "text": "red cotton kurti" }
  Returns: { "embedding": [...768 floats...] }

POST /similarity
  Body: { "image_url": "...", "candidate_embeddings": [{ "product_id": "...", "embedding": [...] }] }
  Returns: { "matches": [{ "product_id": "...", "score": 0.92 }], "top_match": "..." }

POST /upsert_product
  Body: { "product_id": "...", "image_url": "...", "shop_id": "..." }
  Caches embedding in Redis for sub-ms lookups.

GET /health

Environment variables:
  MODEL_NAME    (default: openai/clip-vit-base-patch32)
  REDIS_URL     (default: redis://localhost:6379)
  PORT          (default: 8002)
  HASH_TTL      seconds to cache product embeddings (default: 86400)
"""

import os
import json
import logging
import hashlib
import asyncio
from typing import Optional
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="CLIP Similarity Service", version="1.0.0")

MODEL_NAME = os.getenv("MODEL_NAME", "openai/clip-vit-base-patch32")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
PORT = int(os.getenv("PORT", "8002"))
HASH_TTL = int(os.getenv("HASH_TTL", "86400"))

_model = None
_processor = None
_redis = None


# ---------------------------------------------------------------------------
# Lazy init
# ---------------------------------------------------------------------------

def load_model():
    global _model, _processor
    try:
        from transformers import CLIPModel, CLIPProcessor
        logger.info(f"Loading CLIP model: {MODEL_NAME}")
        _model = CLIPModel.from_pretrained(MODEL_NAME)
        _processor = CLIPProcessor.from_pretrained(MODEL_NAME)
        _model.eval()
        logger.info("CLIP model loaded")
    except Exception as e:
        logger.warning(f"CLIP model load failed: {e}")


async def get_redis():
    global _redis
    if _redis is None:
        try:
            import redis.asyncio as aioredis
            _redis = aioredis.from_url(REDIS_URL, decode_responses=False)
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}")
            _redis = None
    return _redis


def embed_image_url(image_url: str) -> list[float]:
    import requests
    from PIL import Image
    import torch
    resp = requests.get(image_url, timeout=5)
    resp.raise_for_status()
    from io import BytesIO
    image = Image.open(BytesIO(resp.content)).convert("RGB")
    inputs = _processor(images=image, return_tensors="pt")
    with torch.no_grad():
        embedding = _model.get_image_features(**inputs)
    vec = embedding[0].numpy().tolist()
    # L2-normalize
    norm = np.linalg.norm(vec)
    return (np.array(vec) / (norm + 1e-9)).tolist()


def embed_text_str(text: str) -> list[float]:
    import torch
    inputs = _processor(text=[text], return_tensors="pt", padding=True, truncation=True)
    with torch.no_grad():
        embedding = _model.get_text_features(**inputs)
    vec = embedding[0].numpy().tolist()
    norm = np.linalg.norm(vec)
    return (np.array(vec) / (norm + 1e-9)).tolist()


def cosine_sim(a: list, b: list) -> float:
    a_np = np.array(a)
    b_np = np.array(b)
    return float(np.dot(a_np, b_np))  # already L2-normalized


# ---------------------------------------------------------------------------
# Redis cache helpers
# ---------------------------------------------------------------------------

def cache_key(product_id: str, shop_id: str) -> str:
    return f"clip:emb:{shop_id}:{product_id}"


async def get_cached_embedding(product_id: str, shop_id: str):
    r = await get_redis()
    if r is None:
        return None
    try:
        raw = await r.get(cache_key(product_id, shop_id))
        return json.loads(raw) if raw else None
    except Exception:
        return None


async def set_cached_embedding(product_id: str, shop_id: str, embedding: list):
    r = await get_redis()
    if r is None:
        return
    try:
        await r.setex(cache_key(product_id, shop_id), HASH_TTL, json.dumps(embedding))
    except Exception:
        pass


# ---------------------------------------------------------------------------
# FastAPI routes
# ---------------------------------------------------------------------------

class EmbedImageRequest(BaseModel):
    image_url: str


class EmbedTextRequest(BaseModel):
    text: str


class CandidateEmbedding(BaseModel):
    product_id: str
    embedding: list[float]


class SimilarityRequest(BaseModel):
    image_url: str
    candidate_embeddings: list[CandidateEmbedding]
    threshold: float = 0.75


class UpsertProductRequest(BaseModel):
    product_id: str
    image_url: str
    shop_id: str


@app.on_event("startup")
async def startup_event():
    load_model()


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _model is not None, "model": MODEL_NAME}


@app.post("/embed_image")
def embed_image(req: EmbedImageRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")
    try:
        embedding = embed_image_url(req.image_url)
        return {"embedding": embedding, "model": MODEL_NAME, "dims": len(embedding)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed_text")
def embed_text(req: EmbedTextRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")
    try:
        embedding = embed_text_str(req.text)
        return {"embedding": embedding, "dims": len(embedding)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/similarity")
def similarity(req: SimilarityRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")
    try:
        query_embedding = embed_image_url(req.image_url)
        matches = []
        for candidate in req.candidate_embeddings:
            score = cosine_sim(query_embedding, candidate.embedding)
            if score >= req.threshold:
                matches.append({"product_id": candidate.product_id, "score": round(score, 4)})
        matches.sort(key=lambda x: x["score"], reverse=True)
        return {
            "matches": matches,
            "top_match": matches[0]["product_id"] if matches else None,
            "query_dims": len(query_embedding)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upsert_product")
async def upsert_product(req: UpsertProductRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="CLIP model not loaded")
    try:
        embedding = embed_image_url(req.image_url)
        await set_cached_embedding(req.product_id, req.shop_id, embedding)
        return {"product_id": req.product_id, "cached": True, "dims": len(embedding)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/product/{shop_id}/{product_id}")
async def delete_product(shop_id: str, product_id: str):
    r = await get_redis()
    if r:
        await r.delete(cache_key(product_id, shop_id))
    return {"deleted": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
