"""AI status endpoint. Generation itself lives in routes/documents.py -> services/ai_service.py."""
import os

from fastapi import APIRouter

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/health")
def health():
    # Never returns the key itself, only whether one is set.
    return {"provider": os.getenv("AI_PROVIDER", "anthropic"), "configured": bool(os.getenv("AI_API_KEY"))}