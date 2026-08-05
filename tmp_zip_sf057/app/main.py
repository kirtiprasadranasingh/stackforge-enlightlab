from fastapi import FastAPI

app = FastAPI(title="Health stub", version="0.1.0")

@app.get("/")
async def root():
    return {"status": "ok"}

@app.get("/health")
async def health():
    return {"status": "ok"}
