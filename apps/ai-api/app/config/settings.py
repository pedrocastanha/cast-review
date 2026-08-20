import os

OPENAI_URL = "https://api.openai.com/v1/chat/completions"

LLM_TIMEOUT_SECONDS = 180.0

LLM_MAX_TOKENS = 4096

MAX_PROMPT_FILE_CHARS = 6_000
MAX_PROMPT_TOTAL_CHARS = 70_000
MAX_DIFF_CHARS = 16_000

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "portfolio123")
