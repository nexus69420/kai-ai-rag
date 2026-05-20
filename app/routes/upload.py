from fastapi import APIRouter, UploadFile, File
import shutil

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

    file_path = f"temp_{file.filename}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    extracted_text = extract_text_from_pdf(file_path)

    chunks = chunk_text(extracted_text)

    create_collection()

    store_chunks(chunks)

    return {
        "filename": file.filename,
        "total_chunks": len(chunks),
        "message": "Chunks embedded and stored successfully"
    }


