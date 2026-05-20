from fastapi import APIRouter, UploadFile, File
import shutil
import uuid



from app.services.pdf_service import (
    extract_text_from_pdf,
    chunk_text
)

from app.services.vector_service import (
    create_collection,
    store_chunks
)

router = APIRouter()


@router.post("/upload-pdf")
def upload_pdf(file: UploadFile = File(...)):

    document_id = str(uuid.uuid4())

    file_path = f"temp_{file.filename}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    
    extracted_text = extract_text_from_pdf(file_path)

    chunks = chunk_text(extracted_text)

    create_collection()

    store_chunks(chunks, document_id)

    return {
        "filename": file.filename,
        "document_id": document_id,
        "total_chunks": len(chunks),
        "message": "Chunks embedded and stored successfully"
    }


