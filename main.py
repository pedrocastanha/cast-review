import re
import json
import math
from openai import OpenAI
import os
from dotenv import load_dotenv

load_dotenv()

def load_golden_set(file_path: str) -> list[dict]:
    golden_set = []

    # "r" = read mode
    # with creates a context manager. Python automatically closes the file once we're done with it
    with open(file_path, "r", encoding="utf-8") as file:
        for line in file:
            # transform the JSON text into a python object (dictionary)
            example = json.loads(line)

            golden_set.append(example)

    return golden_set

def recall_at_k(
        relevant_passage_ids: list[str],
        retrieved_passage_ids: list[str],
        k: int,
) -> float:
    relevant = set(relevant_passage_ids)

    if not relevant:
        return 0.0

    # the ':k' makes python ignore everything after the k position.
    retrieved_at_k = set(retrieved_passage_ids[:k])

    found = relevant.intersection(retrieved_at_k)

    return len(found) / len(relevant)

# RR -> evaluates ONE query
def reciprocal_rank(
        relevant_passage_ids: list[str],
        retrieved_passage_ids: list[str],
) -> float:
    relevant = set(relevant_passage_ids)

    # enumerate give us the position and the value. That's why we don't use directly retrieved_passage_ids
    for rank, passage_id in enumerate(retrieved_passage_ids, start = 1):
        if passage_id in relevant:
            return 1 / rank
    return 0.0

# MRR -> evaluates a collection of queries by taking the average of their Reciprocal ranks
def mean_reciprocal_rank(
        queries: list[dict],
) -> float:
    if not queries:
        return 0.0

    scores = []

    for query in queries:
        score = reciprocal_rank(
            query["relevant_passage_ids"],
            query["retrieved_passage_ids"],
        )

        scores.append(score)

    return sum(scores) / len(queries)

# Our score is higher when the relevant chunk is near (or) on top
def dcg_at_k(
        relevant_scores: list[int],
        k: int,
) -> float:
    score = 0.0

    for rank, relevance in enumerate(relevant_scores[:k], start = 1):
        score += relevance / math.log2(rank + 1)

    return score

# we sort the relevant scores, because we want all relevant scores near to top, that's the ideal
def ideal_dcg_at_k(
        relevant_scores: list[int],
        k: int,
) -> float:
    ideal_scores = sorted(
        relevant_scores,
        reverse = True,
    )

    return dcg_at_k(ideal_scores, k)

# Measures how good the retrieved ranking is compared with the ideal ranking
def ndcg_at_k(
        relevant_scores: list[int],
        k: int,
) -> float:
    actual_dcg = dcg_at_k(relevant_scores, k)
    ideal_dcg = ideal_dcg_at_k(relevant_scores, k)

    if ideal_dcg == 0:
        return 0.0

    return actual_dcg / ideal_dcg

def build_relevance_scores(
        relevant_passage_ids: list[str],
        retrieved_passage_ids: list[str],
) -> list[int]:
    relevant = set(relevant_passage_ids)
    scores = []

    for passage_id in retrieved_passage_ids:
        if passage_id in relevant:
            scores.append(1)
        else:
            scores.append(0)

    return scores

def evaluate_query(
        relevant_passage_ids: list[str],
        retrieved_passage_ids: list[str],
        k: int
) -> dict:
    relevance_scores = build_relevance_scores(relevant_passage_ids, retrieved_passage_ids)

    return {
        "recall_at_k": recall_at_k(
            relevant_passage_ids,
            retrieved_passage_ids,
            k,
        ),
        "reciprocal_rank": reciprocal_rank(
            relevant_passage_ids,
            retrieved_passage_ids,
        ),
        "ndcg_at_k": ndcg_at_k(relevance_scores, k)
    }

def evaluate_dataset(
        dataset: list[dict],
        k: int
) -> list[dict]:
    results = []

    for example in dataset:
        metrics = evaluate_query(
            example["relevant_passage_ids"],
            example["retrieved_passage_ids"],
            k
        )

        metrics["category"] = example["category"]

        results.append(metrics)

    return results

def aggregate_metrics(
        results: list[dict],
) -> dict:
    if not results:
        return {
            "mean_recall_at_k": 0.0,
            "mrr": 0.0,
            "mean_ndcg_at_k": 0.0,
        }

    mean_recall = sum(
        # like for each result get result["recall_at_k"]
        result["recall_at_k"]
        for result in results
    ) / len(results)

    mrr = sum(
        result["reciprocal_rank"]
        for result in results
    ) / len(results)

    mean_ndcg = sum(
        result["ndcg_at_k"]
        for result in results
    ) / len(results)

    return {
        "mean_recall_at_k": mean_recall,
        "mrr": mrr,
        "mean_ndcg_at_k": mean_ndcg,
    }

def compare_metrics(
        baseline: dict,
        candidate: dict,
) -> dict:
    return {
        "recall_delta": (
            candidate["mean_recall_at_k"]
            - baseline["mean_recall_at_k"]
        ),
        "mrr_delta": (
            candidate["mrr"]
            - baseline["mrr"]
        ),
        "ndcg_delta": (
            candidate["mean_ndcg_at_k"]
            - baseline["mean_ndcg_at_k"]
        ),
    }

def passes_recall_gate(
        baseline_recall: float,
        candidate_recall: float,
        max_drop: float = 0.01,
) -> bool:
    drop = baseline_recall - candidate_recall

    return drop < max_drop or math.isclose(
        drop,
        max_drop,
        abs_tol=1e-9,
    )

def tokenize(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower())

def retrieve_keyword(
        query: str,
        chunks: list[dict],
        k: int
) -> list[str]:
    query_words = set(tokenize(query))

    scored_chunks = []

    for chunk in chunks:
        chunk_words = set(tokenize(chunk["text"]))

        score = len(
            query_words.intersection(chunk_words)
        )

        scored_chunks.append(
            (score, chunk["id"])
        )

    scored_chunks.sort(reverse=True)

    return [
        chunk_id
        for score, chunk_id in scored_chunks[:k]
    ]

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def create_embedding(text: str) -> list[float]:
    response = client.embeddings.create(
        model = "text-embedding-3-small",
        input = text,
    )

    return response.data[0].embedding

def embed_chunks(
        chunks: list[dict],
) -> list[dict]:
    embedded_chunks = []

    for chunk in chunks:
        embedding = create_embedding(chunk["text"])

        embedded_chunks.append({
            "id": chunk["id"],
            "text": chunk["text"],
            "embedding": embedding,
        })

    return embedded_chunks

def cosine_similarity(
        vector_a: list[float],
        vector_b: list[float],
) -> float:
    dot_product = sum(
        a * b
        # zip: pairs values in the same positon
        for a,b in zip(vector_a, vector_b)
    )

    magnitude_a = math.sqrt(
        sum(a * a for a in vector_a)
    )

    magnitude_b = math.sqrt(
        sum(b * b for b in vector_b)
    )

    return dot_product / (magnitude_a * magnitude_b)

def retrieve_dense(
        query: str,
        embedded_chunks: list[dict],
        k: int,
) -> list[str]:
    query_embeddings = create_embedding(query)

    scored_chunks = []

    for chunk in embedded_chunks:
        score = cosine_similarity(
            query_embeddings,
            chunk["embedding"],
        )

        scored_chunks.append(
            (score, chunk["id"])
        )
    scored_chunks.sort(reverse=True)

    return [
        chunk_id
        for score, chunk_id in scored_chunks[:k]
    ]

def retrieve_for_example(
        example: dict,
        retriever,
        chunks: list[dict],
        k: int,
) -> dict:
    retrieved_ids = retriever(
        example["query"],
        chunks,
        k,
    )

    return {
        "query": example["query"],
        "category": example["category"],
        "relevant_passage_ids": example["relevant_passage_ids"],
        "retrieved_passage_ids": retrieved_ids,
    }

def retrieve_dataset(
        golden_set: list[dict],
        retriever,
        chunks: list[dict],
        k: int,
) -> list[dict]:
    results = []

    for example in golden_set:
        retrieved_example = retrieve_for_example(
            example,
            retriever,
            chunks,
            k,
        )

        results.append(retrieved_example)

    return results

def load_chunks(file_path: str) -> list[dict]:
    chunks = []

    with open(file_path, "r", encoding="utf-8") as file:
        for line in file:
            chunk = json.loads(line)
            chunks.append(chunk)

    return chunks

def run_experiment(
        golden_set: list[dict],
        retriever,
        chunks: list[dict],
        k: int,
) -> dict:
    retrieved_dataset = retrieve_dataset(
        golden_set,
        retriever,
        chunks,
        k,
    )

    results = evaluate_dataset(
        retrieved_dataset,
        k,
    )

    overall_metrics = aggregate_metrics(results)

    category_metrics = aggregate_metrics_by_category(results)

    return {
        "overall": overall_metrics,
        "by_category": category_metrics,
    }

def retrieve_hybrid(
        query: str,
        embedded_chunks: list[dict],
        k: int,
        alpha: float = 0.5,
):
    query_words = set(tokenize(query))
    query_embeddings = create_embedding(query)

    scored_chunks = []

    for chunk in embedded_chunks:
        chunk_words = set(tokenize(chunk["text"]))

        common_words = query_words.intersection(chunk_words)

        if query_words:
            keyword_score = len(common_words) / len(query_words)
        else:
            keyword_score = 0.0

        dense_score = cosine_similarity(
            query_embeddings,
            chunk["embedding"],
        )

        dense_score = (dense_score + 1) / 2

        hybrid_score = (
            alpha * dense_score
            + (1 - alpha) * keyword_score
        )

        scored_chunks.append(
            (hybrid_score, chunk["id"])
        )

    scored_chunks.sort(reverse=True)

    return [
        chunk_id
        for score, chunk_id in scored_chunks[:k]
    ]

def aggregate_metrics_by_category(
    results: list[dict],
) -> dict:
    grouped_results = {}

    for result in results:
        category = result["category"]

        if category not in grouped_results:
            grouped_results[category] = []

        grouped_results[category].append(result)

    category_metrics = {}

    for category, category_results in grouped_results.items():
        category_metrics[category] = aggregate_metrics(
            category_results
        )

    return category_metrics

def rerank_with_gpt(
        query: str,
        candidate_ids: list[str],
        chunks: list[dict],
        k: int,
) -> list[str]:
    candidates = []

    for chunk in chunks:
        if chunk["id"] in candidate_ids:
            candidates.append({
                "id": chunk["id"],
                "text": chunk["text"],
            })

    prompt = f"""
You are a retrieval reranker.

Query:
{query}

Candidate passages:
{json.dumps(candidates, ensure_ascii=False)}

Rank the candidate passage IDs from most relevant
to least relevant for answering the query.

Return ONLY a JSON array of IDs.

Example:
["chunk_10", "chunk_42"]
"""

    response = client.responses.create(
        model="gpt-4.1-nano",
        input=prompt,
    )

    ranked_ids = json.loads(response.output_text)

    return ranked_ids[:k]

def retrieve_dense_reranked(
        query: str,
        embedded_chunks: list[dict],
        k: int,
) -> list[str]:
    candidate_k = max(k * 3, k)

    candidate_ids = retrieve_dense(
        query,
        embedded_chunks,
        candidate_k,
    )

    reranked_ids = rerank_with_gpt(
        query,
        candidate_ids,
        embedded_chunks,
        k,
    )

    return reranked_ids

def retrieve_broken(
    query: str,
    chunks: list[dict],
    k: int,
) -> list[str]:
    return []

if __name__ == "__main__":
    golden_set = load_golden_set("golden_set.jsonl")
    chunks = load_chunks("chunks.jsonl")

    embedded_chunks = embed_chunks(chunks)

    keyword_summary = run_experiment(
        golden_set,
        retrieve_keyword,
        chunks,
        k=2,
    )

    dense_summary = run_experiment(
        golden_set,
        retrieve_dense,
        embedded_chunks,
        k=2,
    )

    hybrid_summary = run_experiment(
        golden_set,
        retrieve_hybrid,
        embedded_chunks,
        k=2,
    )

    print("Keyword:")
    print(keyword_summary)

    print("\nDense:")
    print(dense_summary)

    print("\nHybrid:")
    print(hybrid_summary)

    keyword_vs_dense = compare_metrics(
        keyword_summary["overall"],
        dense_summary["overall"],
    )

    hybrid_vs_dense = compare_metrics(
        hybrid_summary["overall"],
        dense_summary["overall"],
    )

    print("\nKeyword -> Dense:")
    print(keyword_vs_dense)

    print("\nHybrid -> Dense:")
    print(hybrid_vs_dense)

    reranked_summary = run_experiment(
        golden_set,
        retrieve_dense_reranked,
        embedded_chunks,
        k=2,
    )

    print("\nReranked:")
    print(reranked_summary)

    dense_vs_reranked = compare_metrics(
        dense_summary["overall"],
        reranked_summary["overall"],
    )

    print("\nDense -> Dense + Reranker:")
    print(dense_vs_reranked)