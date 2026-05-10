import base64
import io
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image

MODEL_PATH = Path(__file__).resolve().parent / "artifacts" / "beauty_model_ridge.joblib"


class PredictRequest(BaseModel):
    image_base64: str


class PredictResponse(BaseModel):
    score: float


app = FastAPI(title="Omoggle Beauty Model API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not MODEL_PATH.exists():
    raise RuntimeError(f"Model not found: {MODEL_PATH}")

model = joblib.load(MODEL_PATH)


def preprocess(image_bytes: bytes, size: int = 48) -> np.ndarray:
    img = Image.open(io.BytesIO(image_bytes)).convert("L").resize((size, size), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return arr.reshape(1, -1)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/predict", response_model=PredictResponse)
def predict(payload: PredictRequest):
    try:
        image_bytes = base64.b64decode(payload.image_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {exc}") from exc

    try:
        x = preprocess(image_bytes)
        pred = float(model.predict(x)[0])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to run model: {exc}") from exc

    return PredictResponse(score=round(max(0.0, min(5.0, pred)), 4))
