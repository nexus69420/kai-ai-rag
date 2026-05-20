# KAI — Knowledge Augmented Intelligence

KAI is an AI-powered RAG (Retrieval-Augmented Generation) chatbot built using FastAPI, React, LangChain, and Google Gemini.

Users can upload PDFs and chat with their documents using semantic retrieval and LLM-powered responses.

---

## Demo

[Click here to watch the demo video](https://drive.google.com/file/d/1sOAaBDWIsMMqMoJmlaOvo_O7Y4TJN6jC/view?usp=sharing)


# Features

* PDF upload and processing
* RAG-based document querying
* Semantic search using embeddings
* Google Gemini integration
* FastAPI backend
* React + Vite frontend
* Modular backend architecture
* Conversational chat interface

---

# Tech Stack

## Backend

* FastAPI
* Python
* LangChain
* Google Gemini API

## Frontend

* React.js
* Vite
* CSS

---

# Project Structure

```bash
kai-ai-rag/
│
├── app/
├── frontend/
├── requirements.txt
├── .gitignore
└── README.md
```

---

# Installation

## Clone Repository

```bash
git clone https://github.com/nexus69420/kai-ai-rag.git
cd kai-ai-rag
```

## Backend Setup

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file:

```env
GOOGLE_API_KEY=your_google_api_key
```

Run backend:

```bash
uvicorn app.main:app --reload
```

---

# Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

---

# Workflow

```text
PDF Upload → Text Chunking → Embeddings → Vector Retrieval → Gemini Response
```

---

# Upcoming Features

* Multi-PDF support
* Persistent chat sessions
* Streaming responses
* Cloud deployment
* Advanced vector database integration

---

# Learning Outcomes

This project demonstrates:

* Retrieval-Augmented Generation (RAG)
* LLM integration
* Semantic retrieval
* Full-stack AI development
* FastAPI backend architecture
* React frontend integration

---

# Author

Aayush Kumar Dubey

GitHub:
[https://github.com/nexus69420](https://github.com/nexus69420)
