import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, StrictStr

from .config import Settings
from .pipeline import DiscoveryService


class DiscoveryInput(BaseModel):
    prompt: StrictStr = Field(min_length=1, max_length=4000)
    count: int = Field(default=10, ge=1, le=100, strict=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with DiscoveryService(Settings.from_env()) as service:
        app.state.discovery = service
        yield


app = FastAPI(title="Captioned Shorts Discovery", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse([], status_code=422)


@app.post("/discover", response_model=list[str])
async def discover(body: DiscoveryInput, request: Request):
    start = time.monotonic()
    try:
        results = await request.app.state.discovery.discover(body.prompt, count=body.count)
    except ValueError:
        return JSONResponse([], status_code=422)
    return JSONResponse(results, headers={"X-Discovery-Elapsed-Ms": str(round((time.monotonic() - start) * 1000))})


@app.get("/health")
async def health():
    return {"status": "ok"}
