from dotenv import load_dotenv

from langchain_google_genai import GoogleGenerativeAIEmbeddings

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from qdrant_client.models import PointStruct
from langchain_community.embeddings import HuggingFaceEmbeddings
import uuid
from qdrant_client.models import Filter, FieldCondition, MatchValue
load_dotenv()

embedding_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

client = QdrantClient(":memory:")

COLLECTION_NAME = "pdf_chunks"


def create_collection():

    if not client.collection_exists(COLLECTION_NAME):

        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(
                size=384,
                distance=Distance.COSINE
            )
        )


def store_chunks(chunks, document_id):

    print("TOTAL CHUNKS:", len(chunks))

    vectors = embedding_model.embed_documents(chunks)

    print("FIRST VECTOR LENGTH:", len(vectors[0]))

    points = []

    for index, vector in enumerate(vectors):

        point = PointStruct(
            id=str(uuid.uuid4()),
            vector=vector,
            payload={
                "text": chunks[index],
                "document_id": document_id

            }
        )

        points.append(point)

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=points
    )

    print("STORED SUCCESSFULLY")

def search_chunks(query: str, document_id: str):

    query_vector = embedding_model.embed_query(query)

    
    search_results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=5,

        query_filter=Filter(
            must=[
                FieldCondition(
                    key="document_id",
                    match=MatchValue(value=document_id)
                )
            ]
        )

    ).points

    

    return search_results