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
            You are an expert AI engineering assistant.
            Give concise, clear, technical answers.
            """
        ),
        ("human", "{user_input}")
    ]
)


import time


def get_ai_response(message: str):

    prompt = prompt_template.invoke(
        {
            "user_input": message
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

def generate_rag_response(query: str, context_chunks):

    context_text = "\n\n".join(context_chunks)

    prompt = f"""
    You are a helpful AI assistant.

    Answer the user's question ONLY using the provided context.

    CONTEXT:
    {context_text}

    QUESTION:
    {query}
    """

    response = model.invoke(prompt)

    return response.content