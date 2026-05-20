from fastapi import APIRouter

from app.models.chat_models import ChatRequest
from app.services.llm_service import get_ai_response

router = APIRouter()


@router.post("/chat")
def chat(request: ChatRequest):

    ai_response = get_ai_response(request.message)

    return {
        "user_message": request.message,
        "ai_response": ai_response
    }