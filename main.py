"""LegalEase API. Start with: uvicorn main:app --reload --port 8000"""
from dotenv import load_dotenv

load_dotenv()  # must run before other modules read environment variables

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models.document import Base, engine
from routes import ai, auth, documents

if len(os.getenv("JWT_SECRET", "")) < 16:
    raise RuntimeError("Set JWT_SECRET (16+ characters) in backend/.env")

Base.metadata.create_all(engine)  # creates tables on first run

app = FastAPI(title="LegalEase API")

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5500").split(",")]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

for router in (auth.router, documents.router, ai.router):
    app.include_router(router)