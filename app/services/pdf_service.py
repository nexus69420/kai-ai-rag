from pypdf import PdfReader

from langchain_text_splitters import RecursiveCharacterTextSplitter


def extract_text_from_pdf(file_path: str):

    reader = PdfReader(file_path)

    text = ""

    for page in reader.pages:
        extracted = page.extract_text()

        if extracted:
            text += extracted

    return text


def chunk_text(text: str):

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=850,
        chunk_overlap=150
    )

    chunks = text_splitter.split_text(text)

    return chunks