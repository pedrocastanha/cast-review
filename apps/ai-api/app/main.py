from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from langgraph.checkpoint.redis.aio import AsyncRedisSaver

from app.api.routes.agent import router
from app.config.settings import REDIS_URL
from app.graph.graph import build_graph


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncExitStack() as stack:
        saver = await stack.enter_async_context(AsyncRedisSaver.from_conn_string(REDIS_URL))
        await saver.asetup()
        app.state.graph = build_graph(saver)
        yield


app = FastAPI(title="Cast Review AI API", lifespan=lifespan)

app.include_router(router)
