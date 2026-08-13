from fastapi import FastAPI

from app.api.routes.agent import router

app = FastAPI(title="Cast Review AI API")

app.include_router(router)
