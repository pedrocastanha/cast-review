import os

OPENAI_URL = "https://api.openai.com/v1/chat/completions"

LLM_TIMEOUT_SECONDS = 180.0

LLM_MAX_TOKENS = 4096

MAX_PROMPT_FILE_CHARS = 6_000
MAX_PROMPT_TOTAL_CHARS = 70_000
MAX_DIFF_CHARS = 16_000

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
