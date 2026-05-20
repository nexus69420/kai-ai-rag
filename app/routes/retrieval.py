from fastapi import APIRouter

from app.models.chat_models import ChatRequest
from app.services.vector_service import search_chunks

router = APIRouter()


@router.post("/search")

def semantic_search(request: ChatRequest):

    results = search_chunks(request.message)

    retrieved_chunks = []

    for result in results:

        retrieved_chunks.append(
            {
                "score": result.score,
                "text": result.payload["text"]
            }
        )

    return {
        "query": request.message,
        "results": retrieved_chunks
    }