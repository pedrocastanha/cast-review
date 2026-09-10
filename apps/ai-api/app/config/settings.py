import os

APP_ENV = os.environ.get("APP_ENV", "development")

OPENAI_URL = os.environ.get(
    "OPENAI_URL", "https://api.openai.com/v1/chat/completions"
)

LLM_TIMEOUT_SECONDS = 180.0

LLM_MAX_TOKENS = 4096

MAX_PROMPT_FILE_CHARS = 6_000
MAX_PROMPT_TOTAL_CHARS = 70_000
MAX_DIFF_CHARS = 16_000

IS_PRODUCTION = APP_ENV == "production"

ALLOW_INSECURE_DEPENDENCIES = os.environ.get(
    "ALLOW_INSECURE_DEPENDENCIES", ""
).strip().lower() in {"1", "true", "yes", "on"}


def _required(name: str, development_default: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    if IS_PRODUCTION:
        raise RuntimeError(f"{name} obrigatório em produção")
    return development_default


REDIS_URL = _required("REDIS_URL", "redis://localhost:6379")

NEO4J_URI = _required("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = _required("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = _required("NEO4J_PASSWORD", "portfolio123")

CODE_GRAPH_MAX_FILES = int(os.environ.get("CODE_GRAPH_MAX_FILES", "1000"))


SECURE_REDIS_SCHEMES = ("rediss://",)
SECURE_NEO4J_SCHEMES = ("neo4j+s://", "neo4j+ssc://", "bolt+s://", "bolt+ssc://")

INSECURE_DEPENDENCY_HINT = (
    "Em self-host com a dependência em rede privada, defina "
    "ALLOW_INSECURE_DEPENDENCIES=true de forma explícita"
)


def validate_production_config() -> None:
    if not IS_PRODUCTION:
        return

    if len(os.environ.get("AI_SERVICE_TOKEN", "")) < 32:
        raise RuntimeError("AI_SERVICE_TOKEN is required")

    if NEO4J_PASSWORD == "portfolio123":
        raise RuntimeError("NEO4J_PASSWORD inválido")

    # Neo4j Community não tem RBAC: um usuário dedicado NÃO reduz privilégio,
    # todos são efetivamente admin. O que ele dá é separação de credencial —
    # a credencial da aplicação pode ser rotacionada ou revogada sem mexer na
    # conta `neo4j`, que é a que administra auth e configuração do servidor.
    if NEO4J_USER == "neo4j":
        raise RuntimeError(
            "NEO4J_USER não deve ser a conta administrativa padrão em produção"
        )

    if ALLOW_INSECURE_DEPENDENCIES:
        return

    if not REDIS_URL.startswith(SECURE_REDIS_SCHEMES):
        raise RuntimeError(
            f"REDIS_URL deve usar rediss:// em produção. {INSECURE_DEPENDENCY_HINT}"
        )

    if not NEO4J_URI.startswith(SECURE_NEO4J_SCHEMES):
        raise RuntimeError(
            f"NEO4J_URI deve usar um esquema TLS em produção. {INSECURE_DEPENDENCY_HINT}"
        )
