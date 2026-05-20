from fastapi import APIRouter

from app.models.chat_models import ChatRequest

from app.services.vector_service import search_chunks
from app.services.llm_service import generate_rag_response

router = APIRouter()


@router.post("/rag-chat")

def rag_chat(request: ChatRequest):

    search_results = search_chunks(request.message)

    retrieved_chunks = []

    for result in search_results:

        retrieved_chunks.append(
            result.payload["text"]
        )

    ai_response = generate_rag_response(
        request.message,
        retrieved_chunks
    )

    return {
        "question": request.message,
        "retrieved_chunks": retrieved_chunks,
        "answer": ai_response
    }