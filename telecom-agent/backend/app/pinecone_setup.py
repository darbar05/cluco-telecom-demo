"""
Pinecone index creation and knowledge base seeding.
Uses OpenAI text-embedding-3-small for embeddings.
"""
import os
import time
from dotenv import load_dotenv
from pinecone import Pinecone, ServerlessSpec
from openai import OpenAI

from app.knowledge_base import get_all_documents

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX_NAME", "telecom-kb")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536


def get_embedding(text: str, client: OpenAI) -> list[float]:
    response = client.embeddings.create(input=text, model=EMBEDDING_MODEL)
    return response.data[0].embedding


def create_index(pc: Pinecone):
    existing = [idx.name for idx in pc.list_indexes()]
    if PINECONE_INDEX_NAME in existing:
        print(f"Index '{PINECONE_INDEX_NAME}' already exists, skipping creation.")
        return

    print(f"Creating index '{PINECONE_INDEX_NAME}'...")
    pc.create_index(
        name=PINECONE_INDEX_NAME,
        dimension=EMBEDDING_DIM,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
    )
    while not pc.describe_index(PINECONE_INDEX_NAME).status["ready"]:
        print("  Waiting for index to be ready...")
        time.sleep(2)
    print("  Index is ready.")


def seed_knowledge_base():
    pc = Pinecone(api_key=PINECONE_API_KEY)
    openai_client = OpenAI(api_key=OPENAI_API_KEY)

    create_index(pc)
    index = pc.Index(PINECONE_INDEX_NAME)

    documents = get_all_documents()
    print(f"Seeding {len(documents)} documents into Pinecone...")

    for category in ["billing", "products", "support"]:
        cat_docs = [d for d in documents if d["category"] == category]
        if not cat_docs:
            continue

        vectors = []
        for doc in cat_docs:
            embed_text = f"{doc['title']}\n{doc['content']}"
            embedding = get_embedding(embed_text, openai_client)
            vectors.append({
                "id": doc["id"],
                "values": embedding,
                "metadata": {
                    "category": doc["category"],
                    "subcategory": doc["subcategory"],
                    "title": doc["title"],
                    "content": doc["content"],
                    "doc_id": doc["id"],
                },
            })

        index.upsert(vectors=vectors, namespace=category)
        print(f"  Seeded {len(vectors)} documents in namespace '{category}'")

    time.sleep(2)
    stats = index.describe_index_stats()
    print(f"Index stats: {stats}")
    print("Knowledge base seeding complete.")


def query_knowledge_base(query: str, category: str, top_k: int = 3) -> list[dict]:
    pc = Pinecone(api_key=PINECONE_API_KEY)
    openai_client = OpenAI(api_key=OPENAI_API_KEY)
    index = pc.Index(PINECONE_INDEX_NAME)

    query_embedding = get_embedding(query, openai_client)
    results = index.query(
        vector=query_embedding,
        top_k=top_k,
        namespace=category,
        include_metadata=True,
    )

    docs = []
    for match in results.matches:
        docs.append({
            "id": match.id,
            "score": match.score,
            "title": match.metadata.get("title", ""),
            "content": match.metadata.get("content", ""),
            "category": match.metadata.get("category", ""),
            "subcategory": match.metadata.get("subcategory", ""),
        })
    return docs


def query_multiple_namespaces(query: str, namespaces: list[str], top_k: int = 3) -> list[dict]:
    """Retrieve from multiple namespaces and merge results, sorted by score."""
    all_docs = []
    for ns in namespaces:
        all_docs.extend(query_knowledge_base(query, ns, top_k=top_k))
    all_docs.sort(key=lambda d: d["score"], reverse=True)
    return all_docs[:top_k]


if __name__ == "__main__":
    seed_knowledge_base()
