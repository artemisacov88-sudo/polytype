#!/usr/bin/env python3
"""Document-held-out comparison of OANC prefix prediction algorithms.

All n-gram probabilities are estimated from the train-only SQLite database.
Pruning affects candidate generation only: absolute-discount denominators and
continuation-type counts are computed from complete, unpruned train counts.
Use --split validation to tune parameters; use --split test once for reporting.
"""
from __future__ import annotations

import argparse
import bisect
import json
import math
import random
import sqlite3
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "local-corpora/oanc/metadata/ngrams.sqlite3"
PREPARED = ROOT / "local-corpora/oanc/prepared"
DICTIONARY = ROOT / "src/prediction/data/english-words.json"
COLLOCATIONS = ROOT / "src/prediction/data/english-collocations.json"
FORWARD_RELATIONS = {"NOUN_noun_after", "NOUN_prep_after", "VERB_noun_object",
                     "VERB_prep_after", "ADJ_noun", "ADJ_prep_after"}


def top_prefix(words, counts, prefix, limit):
    start = bisect.bisect_left(words, prefix)
    matches = []
    for word in words[start:]:
        if not word.startswith(prefix): break
        matches.append(word)
    return sorted(matches, key=lambda word: (-counts.get(word, 0), word))[:limit]


def bound_candidates(words, unigram, limit=100):
    return sorted(set(words), key=lambda word: (-unigram.get(word, 0), word))[:limit]


def finish(raw):
    n = max(1, raw["queries"])
    return {"queries": raw["queries"], "top1_accuracy": raw["top1"] / n,
            "top5_accuracy": raw["top5"] / n, "mrr": raw["mrr"] / n,
            "coverage": raw["coverage"] / n,
            "target_candidate_coverage": raw["target_coverage"] / n}


def update(raw, target, ranked):
    raw["queries"] += 1
    raw["coverage"] += bool(ranked)
    if target in ranked:
        rank = ranked.index(target) + 1
        raw["target_coverage"] += 1
        raw["mrr"] += 1 / rank
        raw["top1"] += rank == 1
        raw["top5"] += rank <= 5


def collocation_scores(data, previous, prefix):
    results = {}
    entry = data.get(previous, {}) if isinstance(data, dict) else {}
    for relation, partners in entry.items() if isinstance(entry, dict) else []:
        if relation not in FORWARD_RELATIONS: continue
        if not isinstance(partners, list): continue
        for partner in partners:
            if isinstance(partner, dict) and isinstance(partner.get("word"), str) \
                    and partner["word"].startswith(prefix):
                candidate = (float(partner.get("score", 0)), int(partner.get("count", 0)))
                if partner["word"] not in results or candidate[0] > results[partner["word"]][0]:
                    results[partner["word"]] = candidate
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=DB_PATH)
    parser.add_argument("--prepared", type=Path, default=PREPARED)
    parser.add_argument("--split", choices=("validation", "test"), default="validation")
    parser.add_argument("--dictionary", type=Path, default=DICTIONARY)
    parser.add_argument("--collocations", type=Path, default=COLLOCATIONS)
    parser.add_argument("--max-examples", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=491)
    parser.add_argument("--pruning-config", choices=("full", "moderate", "compact"), default="moderate")
    parser.add_argument("--discount", type=float, default=0.5)
    parser.add_argument("--frequency-weight", type=float, default=0.15)
    parser.add_argument("--reliability-weight", type=float, default=0.10)
    parser.add_argument("--collocation-weight", type=float, default=0.0)
    parser.add_argument("--tune-ranking", action="store_true",
                        help="Evaluate a small weight grid; allowed on validation only")
    parser.add_argument("--tune-discount", action="store_true",
                        help="Evaluate absolute discounts 0.25/0.50/0.75; validation only")
    args = parser.parse_args()
    started = time.perf_counter()
    minimum, successor_limit = {"full": (1, 0), "moderate": (2, 50), "compact": (3, 20)}[args.pruning_config]
    if not 0 <= args.discount < 1 or min(args.frequency_weight, args.reliability_weight,
                                          args.collocation_weight) < 0:
        raise SystemExit("discount must be in [0,1); ranking weights must be non-negative")
    if (args.tune_ranking or args.tune_discount) and args.split != "validation":
        raise SystemExit("parameter tuning is restricted to the validation split")
    db = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    db.execute("PRAGMA query_only=ON")
    unigram = dict(db.execute("SELECT next_word,count FROM ngrams WHERE order_n=1"))
    unigram_total = sum(unigram.values())
    vocab_words = sorted(unigram)
    dictionary_data = json.loads(args.dictionary.read_text(encoding="utf-8"))
    dictionary = {item["word"].lower(): int(item["frequency"]) for item in dictionary_data}
    dict_words = sorted(dictionary)
    colloc_data = json.loads(args.collocations.read_text(encoding="utf-8")) if args.collocations.exists() else {}

    rng = random.Random(args.seed)
    examples = []
    seen = 0
    with (args.prepared / f"{args.split}.jsonl").open(encoding="utf-8") as source:
        for line in source:
            record = json.loads(line)
            tokens = record["tokens"]
            for position in range(1, len(tokens)):
                target = tokens[position]
                seen += 1
                example = (record["document"], position, tokens, target)
                if len(examples) < args.max_examples:
                    examples.append(example)
                else:
                    slot = rng.randrange(seen)
                    if slot < args.max_examples: examples[slot] = example
    examples.sort(key=lambda item: (item[0], item[1]))
    if not examples: raise SystemExit(f"No evaluable examples in {args.split}")

    names = ("trie", "trie_unigram", "trie_longest_backoff", "trie_interpolated_absolute_discount",
             "full_ranking", "full_ranking_with_collocations")
    raw = {name: defaultdict(lambda: defaultdict(float)) for name in names}
    tuning_grid = [(frequency, reliability, collocation)
                   for frequency in (0.0, 0.05, 0.15, 0.30)
                   for reliability in (0.0, 0.10)
                   for collocation in (0.0, 0.05, 0.15)] if args.tune_ranking else []
    tuned_raw = {weights: defaultdict(lambda: defaultdict(float)) for weights in tuning_grid}
    discount_grid = (0.25, 0.50, 0.75) if args.tune_discount else ()
    discount_raw = {discount: defaultdict(lambda: defaultdict(float)) for discount in discount_grid}
    collocation_impact = {"queries": 0, "target_has_collocation": 0, "target_added_by_collocation": 0,
                          "source_only_improved": 0, "source_only_worsened": 0,
                          "signal_improved": 0, "signal_worsened": 0, "signal_unchanged": 0,
                          "examples": {"added": [], "improved": [], "worsened": []}}
    context_cache = {}
    prefix_cache = {}
    for _, position, tokens, target in examples:
        prefix = target[:min(3, len(target))]
        prefix_group = "1" if len(prefix) == 1 else "2" if len(prefix) == 2 else "3+"
        context = tuple(tokens[max(0, position - 3):position])
        context_group = str(len(context))
        if context not in context_cache:
            context_cache[context] = get_context_data(db, context, minimum, successor_limit)
        context_data = context_cache[context]
        if prefix not in prefix_cache:
            trie = top_prefix(dict_words, dictionary, prefix, 50)
            uni = top_prefix(vocab_words, unigram, prefix, 50)
            prefix_cache[prefix] = (trie, uni)
        trie, uni = prefix_cache[prefix]
        base_pool = list(dict.fromkeys(trie + uni))
        rows = context_data["pruned"]
        context_candidates = {word for order_rows in rows.values() for word in order_rows
                              if word.startswith(prefix)}
        pool = bound_candidates(base_pool + sorted(context_candidates), unigram, 100)
        colloc = collocation_scores(colloc_data, context[-1] if context else "", prefix)

        matching = {1: {}}
        chosen_order = 1
        for order, order_rows in rows.items():
            hits = {word: count for word, count in order_rows.items() if word.startswith(prefix)}
            matching[order] = hits
            if order > chosen_order and hits: chosen_order = order
        longest_pool = bound_candidates(base_pool + list(matching[chosen_order]), unigram, 100)
        longest = sorted(longest_pool,
                         key=lambda word: (-matching[chosen_order].get(word, 0), -chosen_order,
                                           -unigram.get(word, 0), word))[:5]
        trie_rank = sorted(trie, key=lambda word: (-dictionary.get(word, 0), word))[:5]
        unigram_rank = sorted(base_pool, key=lambda word: (-unigram.get(word, 0),
                                                            -dictionary.get(word, 0), word))[:5]

        probabilities = {word: iad_probability(word, context_data, unigram,
                                                unigram_total, args.discount) for word in pool}
        iad_rank = sorted(pool, key=lambda word: (-probabilities[word], -unigram.get(word, 0), word))[:5]
        max_probability = max(probabilities.values(), default=0)
        max_frequency = math.log1p(max(unigram.values(), default=0))
        probability_norm = {word: probabilities[word] / max_probability if max_probability else 0 for word in pool}
        frequency_norm = {word: math.log1p(unigram.get(word, 0)) / max_frequency if max_frequency else 0
                          for word in pool}
        candidate_order = {word: max((order for order, hits in matching.items() if word in hits), default=0)
                           for word in pool}
        reliability_norm = {word: candidate_order[word] / 3 for word in pool}
        colloc_pool = bound_candidates(pool + sorted(colloc), unigram, 100)
        for word in colloc_pool:
            if word not in probabilities:
                probabilities[word] = iad_probability(word, context_data, unigram,
                                                       unigram_total, args.discount)
        colloc_norm = {
            word: min(1.0, max(0.0, colloc.get(word, (0, 0))[0] / 14))
            * max(0, colloc.get(word, (0, 0))[1]) / (max(0, colloc.get(word, (0, 0))[1]) + 5)
            for word in colloc_pool
        }

        total_weight = 1 + args.frequency_weight + args.reliability_weight
        full_scores = {word: (probability_norm[word] + args.frequency_weight * frequency_norm[word]
                              + args.reliability_weight * reliability_norm[word]) / total_weight for word in pool}
        full_rank = sorted(pool, key=lambda word: (-full_scores[word], -unigram.get(word, 0), word))[:5]
        colloc_weight = args.collocation_weight
        colloc_max_probability = max(probabilities[word] for word in colloc_pool) if colloc_pool else 0
        colloc_probability_norm = {word: probabilities[word] / colloc_max_probability if colloc_max_probability else 0
                                   for word in colloc_pool}
        colloc_frequency_norm = {word: math.log1p(unigram.get(word, 0)) / max_frequency
                                 if max_frequency else 0 for word in colloc_pool}
        colloc_scores_norm = {}
        for word in colloc_pool:
            prob = colloc_probability_norm[word]
            freq = colloc_frequency_norm[word]
            reliability = candidate_order.get(word, 0) / 3
            score = (prob + args.frequency_weight * freq + args.reliability_weight * reliability) / total_weight
            colloc_scores_norm[word] = (score + colloc_weight * colloc_norm[word]) / (1 + colloc_weight)
        source_only_scores = {}
        for word in colloc_pool:
            source_only_scores[word] = (colloc_probability_norm[word]
                + args.frequency_weight * colloc_frequency_norm[word]
                + args.reliability_weight * candidate_order.get(word, 0) / 3) / total_weight
        source_only_rank = sorted(colloc_pool, key=lambda word: (-source_only_scores[word],
                                                                  -unigram.get(word, 0), word))[:5]
        colloc_rank = sorted(colloc_pool, key=lambda word: (-colloc_scores_norm[word],
                                                             -unigram.get(word, 0), word))[:5]
        collocation_impact["queries"] += 1
        if target in colloc: collocation_impact["target_has_collocation"] += 1
        if target not in pool and target in colloc_pool:
            collocation_impact["target_added_by_collocation"] += 1
            if len(collocation_impact["examples"]["added"]) < 5:
                collocation_impact["examples"]["added"].append({"context": list(context), "prefix": prefix,
                    "target": target, "collocation": colloc.get(target)})
        base_rank = source_only_rank.index(target) + 1 if target in source_only_rank else 0
        signal_rank = colloc_rank.index(target) + 1 if target in colloc_rank else 0
        if signal_rank and (not base_rank or signal_rank < base_rank):
            collocation_impact["signal_improved"] += 1
            if len(collocation_impact["examples"]["improved"]) < 5:
                collocation_impact["examples"]["improved"].append({"context": list(context), "prefix": prefix,
                    "target": target, "rank_before": base_rank, "rank_after": signal_rank,
                    "collocation": colloc.get(target)})
        elif base_rank and (not signal_rank or signal_rank > base_rank):
            collocation_impact["signal_worsened"] += 1
            if len(collocation_impact["examples"]["worsened"]) < 5:
                collocation_impact["examples"]["worsened"].append({"context": list(context), "prefix": prefix,
                    "target": target, "rank_before": base_rank, "rank_after": signal_rank,
                    "collocation": colloc.get(target)})
        else:
            collocation_impact["signal_unchanged"] += 1
        results = (trie_rank, unigram_rank, longest, iad_rank, full_rank, colloc_rank)
        for name, ranked in zip(names, results):
            update(raw[name]["all"], target, ranked)
            update(raw[name][f"prefix_{prefix_group}"], target, ranked)
            update(raw[name][f"context_{context_group}"], target, ranked)
        for frequency_weight, reliability_weight, collocation_weight in tuning_grid:
            total_weight = 1 + frequency_weight + reliability_weight
            scores = {}
            tuning_pool = colloc_pool if collocation_weight > 0 else pool
            for word in tuning_pool:
                prob_feature = colloc_probability_norm[word] if collocation_weight > 0 else probability_norm[word]
                freq_feature = colloc_frequency_norm[word] if collocation_weight > 0 else frequency_norm[word]
                score = (prob_feature + frequency_weight * freq_feature
                         + reliability_weight * candidate_order.get(word, 0) / 3) / total_weight
                scores[word] = (score + collocation_weight * colloc_norm[word]) / (1 + collocation_weight)
            ranked = sorted(tuning_pool, key=lambda word: (-scores[word], -unigram.get(word, 0), word))[:5]
            update(tuned_raw[(frequency_weight, reliability_weight, collocation_weight)]["all"], target, ranked)
        for discount in discount_grid:
            scores = {word: iad_probability(word, context_data, unigram, unigram_total, discount) for word in pool}
            ranked = sorted(pool, key=lambda word: (-scores[word], -unigram.get(word, 0), word))[:5]
            update(discount_raw[discount]["all"], target, ranked)
            update(discount_raw[discount][f"prefix_{prefix_group}"], target, ranked)
            update(discount_raw[discount][f"context_{context_group}"], target, ranked)

    report = {
        "corpus": "OANC GrAF 2026-09-25", "split": args.split,
        "split_method": "document-level SHA-256 80/10/10; held-out documents are excluded from train DB",
        "pruning_config": args.pruning_config,
        "candidate_pruning": {"min_count": minimum, "max_successors_per_context": successor_limit or None,
                              "candidate_pool_limit": 100, "full_unigram_prefix_limit": 50},
        "probability_statistics": "full train context totals/types from SQLite; retained PTNG counts score observed mass, all omitted mass backs off",
        "parameters": {"absolute_discount": args.discount, "frequency_weight": args.frequency_weight,
                       "context_reliability_weight": args.reliability_weight,
                       "collocation_weight": args.collocation_weight},
        "examples_seen": seen, "examples_evaluated": len(examples), "seed": args.seed,
        "systems": {name: {group: finish(metrics) for group, metrics in groups.items()}
                    for name, groups in raw.items()},
        "collocation_impact": collocation_impact,
        "validation_ranking_grid": {
            str(weights): finish(groups["all"])
            for weights, groups in tuned_raw.items()
        } if args.tune_ranking else None,
        "validation_discount_grid": {
            str(discount): {group: finish(metrics) for group, metrics in groups.items()}
            for discount, groups in discount_raw.items()
        } if args.tune_discount else None,
        "elapsed_seconds": round(time.perf_counter() - started, 3),
    }
    suffix = "-tuning" if args.tune_ranking or args.tune_discount else ""
    output = ROOT / f"data/experiments/evaluation-{args.split}-{args.pruning_config}-stage5{suffix}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    db.close()


def get_context_data(db, context, minimum, successor_limit):
    full, pruned = {}, {}
    for length in range(1, min(3, len(context)) + 1):
        order = length + 1
        key = " ".join(context[-length:])
        all_rows = db.execute("SELECT next_word,count FROM ngrams WHERE order_n=? AND context=? ORDER BY count DESC,next_word",
                              (order, key)).fetchall()
        full[order] = {word: count for word, count in all_rows}
        kept = [(word, count) for word, count in all_rows if count >= minimum]
        if successor_limit: kept = kept[:successor_limit]
        pruned[order] = {word: count for word, count in kept}
    return {"full": full, "pruned": pruned}


def iad_probability(word, context_data, unigram, unigram_total, discount):
    probability = unigram.get(word, 0) / unigram_total if unigram_total else 0
    for order in sorted(context_data["full"]):
        full_counts = context_data["full"][order]
        total = sum(full_counts.values())
        retained = context_data["pruned"].get(order, {})
        if not total or not retained: continue
        retained_discounted_mass = sum(max(count - discount, 0) for count in retained.values()) / total
        count = retained.get(word, 0)
        observed = max(count - discount, 0) / total
        probability = observed + max(0, 1 - retained_discounted_mass) * probability
    return probability


if __name__ == "__main__":
    main()
