from contextlib import AsyncExitStack, asynccontextmanager
import os

from fastapi import FastAPI
from langgraph.checkpoint.redis.aio import AsyncRedisSaver

from app.api.routes.agent import router as agent_router
from app.api.routes.architecture import router as architecture_router
from app.api.routes.chat import router as chat_router
from app.api.routes.index import router as index_router
from app.code_graph.cache import build_neo4j_driver, build_redis_client
from app.config.settings import REDIS_URL
from app.graph.graph import build_graph
from app.security import ServiceAuthentication
from app.infrastructure.logging.setup import configure_logging, get_logger

configure_logging()
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.environ.get('APP_ENV') == 'production' and len(os.environ.get('AI_SERVICE_TOKEN', '')) < 32:
        raise RuntimeError('AI_SERVICE_TOKEN is required')
    async with AsyncExitStack() as stack:
        saver = await stack.enter_async_context(AsyncRedisSaver.from_conn_string(REDIS_URL))
        await saver.asetup()
        app.state.graph = build_graph(saver)

        app.state.neo4j_driver = await stack.enter_async_context(build_neo4j_driver())
        app.state.index_redis = await stack.enter_async_context(build_redis_client())
        log.info("app.startup")
        yield
        log.info("app.shutdown")


app = FastAPI(title="Cast Review AI API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(ServiceAuthentication)

app.include_router(agent_router)
app.include_router(index_router)
app.include_router(chat_router)
app.include_router(architecture_router)
