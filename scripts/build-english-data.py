import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src/prediction/data/OANC_derived_word_lists"
OUTPUT = ROOT / "src/prediction/data"

# Частотный словарь
words = {}

with open(DATA / "oanc_wordfreq_written.csv", encoding="utf-8") as file:
    reader = csv.DictReader(file)

    for row in reader:
        word = row["lemma"].strip().lower()

        if word and word.isalpha():
            frequency = int(row["count"])

            if word not in words or frequency > words[word]["frequency"]:
                words[word] = {
                    "word": word,
                    "frequency": frequency,
                    "pos": row["pos"],
                }

# Контекстные связи с сохранением оценок
with open(DATA / "oanc_collocations.json", encoding="utf-8") as file:
    source = json.load(file)

collocations = {}

for headword, parts in source["entries"].items():
    headword = headword.lower()
    relations = {}

    for pos, data in parts.items():
        for relation, partners in data.items():
            if relation == "freq":
                continue

            key = f"{pos}_{relation}"

            relations[key] = [
                {
                    "word": partner[0].lower(),
                    "count": partner[1],
                    "score": partner[2],
                }
                for partner in partners
            ]

    if relations:
        collocations[headword] = relations

# Сохранение
with open(OUTPUT / "english-words.json", "w", encoding="utf-8") as file:
    json.dump(
        list(words.values()),
        file,
        ensure_ascii=False,
        separators=(",", ":"),
    )

with open(OUTPUT / "english-collocations.json", "w", encoding="utf-8") as file:
    json.dump(
        collocations,
        file,
        ensure_ascii=False,
        separators=(",", ":"),
    )

print("Готово!")
print("Уникальных слов:", len(words))
print("Слов с коллокациями:", len(collocations))
