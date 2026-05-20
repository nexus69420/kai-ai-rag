from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    document_id: str