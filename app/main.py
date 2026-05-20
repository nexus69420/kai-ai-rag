from fastapi import FastAPI



from app.routes.upload import router as upload_router
from app.routes.retrieval import router as retrieval_router
from app.routes.rag import router as rag_router
from fastapi.middleware.cors import CORSMiddleware



app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(upload_router)
app.include_router(retrieval_router)
app.include_router(rag_router)


@app.get("/")
def home():
    return {"message": "AI Backend Running"}