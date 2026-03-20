# TelcoAssist - Telecom Customer Support Agent

A real-world telecom customer service agent built with LangGraph, Pinecone, and OpenAI. Traces are sent to the Cluco Observability platform for monitoring and evaluation.

## Architecture

- **Router Agent**: Classifies queries into billing/products/support
- **Billing Agent**: RAG over billing knowledge base (plans, pricing, payments)
- **Product Agent**: RAG over product knowledge base (devices, upgrades, accessories)
- **Support Agent**: RAG over support knowledge base (troubleshooting, SIM, network)
- **Response Formatter**: Polishes specialist responses into customer-friendly answers

### v1 vs v2

- **v1**: Uses a vague router prompt that misroutes cross-category queries (e.g., "upgrade device without increasing bill" -> billing instead of products)
- **v2**: Fixed routing with explicit disambiguation rules and cross-namespace retrieval

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- MongoDB running locally
- Cluco Observability backend running on port 9410

### 1. Backend Setup

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your API keys
```

### 2. Seed Knowledge Base

```bash
cd backend
python setup_kb.py
```

### 3. Start Backend

```bash
cd backend
python -m uvicorn app.chat_server:app --host 0.0.0.0 --port 9412 --reload
```

### 4. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

### 5. Open the App

- TelcoAssist Chat: http://localhost:9413
- Cluco Dashboard: http://localhost:9411

## Ports

| Service | Port |
|---------|------|
| TelcoAssist Backend | 9412 |
| TelcoAssist Frontend | 9413 |
| Cluco Backend | 9410 |
| Cluco UI | 9411 |
