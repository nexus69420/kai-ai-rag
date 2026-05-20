from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate

load_dotenv()

model = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    temperature=0.7
)

prompt_template = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """
You are an advanced AI document assistant.

Your task is to answer the user's question STRICTLY using the provided context extracted from uploaded PDF documents.

RULES:
- Only use information present in the context.
- Do NOT make up facts.
- Do NOT use outside knowledge.
- If the answer is not clearly present in the context, say:
  "The answer could not be found in the uploaded document."
- Keep answers accurate, concise, and well-structured.
- If the user asks for lists, provide bullet points.
- Preserve factual and numerical information exactly as written in the context.
            """
        ),
        (
            "human",
            """
CONTEXT:
{context}

QUESTION:
{user_input}

ANSWER:
            """
        )
    ]
)


import time




def generate_rag_response(query: str, context: str):

    prompt = prompt_template.invoke(
        {
            "user_input": query,
            "context": context
        }
    )

    retries = 3

    for attempt in range(retries):

        try:

            response = model.invoke(prompt)

            return response.content

        except Exception as e:

            print(f"Attempt {attempt + 1} failed:", e)

            time.sleep(2)

    return "Gemini is currently overloaded. Please try again later."