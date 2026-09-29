"""AI service. To add a provider, write a class with complete() and register it in PROVIDERS.
Nothing else in the app needs to change."""
import os

import httpx


class AIError(Exception):
    """Friendly error that routes convert into an HTTP response."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class AnthropicProvider:
    def complete(self, system: str, user: str, key: str, model: str) -> str:
        response = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
            json={"model": model, "max_tokens": 3000, "system": system,
                  "messages": [{"role": "user", "content": user}]},
            timeout=90,
        )
        response.raise_for_status()
        return response.json()["content"][0]["text"]


class OpenAICompatibleProvider:
    def complete(self, system: str, user: str, key: str, model: str) -> str:
        base = os.getenv("AI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        response = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model, "max_tokens": 3000,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
            timeout=90,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


PROVIDERS = {"anthropic": AnthropicProvider, "openai": OpenAICompatibleProvider}


def generate_draft(system: str, user: str) -> str:
    key = os.getenv("AI_API_KEY")
    if not key:
        raise AIError("AI is not configured yet. Add AI_API_KEY to backend/.env.", 503)
    provider = PROVIDERS.get(os.getenv("AI_PROVIDER", "anthropic"))
    if not provider:
        raise AIError("AI_PROVIDER in backend/.env is not supported.", 503)
    try:
        text = provider().complete(system, user, key, os.getenv("AI_MODEL", "claude-sonnet-5"))
    except httpx.TimeoutException:
        raise AIError("The AI service took too long to respond. Please try again.", 504)
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        # Details are deliberately not logged or returned: they could contain user data or key info.
        raise AIError("The AI service is unavailable right now. Please try again in a moment.")
    text = text.strip()
    if not text:
        raise AIError("The AI returned an empty draft. Please try again.")
    return text