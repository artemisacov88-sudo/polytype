#!/usr/bin/env python3
"""
Build reusable word resources from the Open American National Corpus (OANC).

Input : oanc/text/OANC-GrAF/data/**/*.txt   (extracted from OANC_GrAF.zip, plain text only)
Output: ../oanc_sentences_learner.json     curated learner-friendly example sentences
        ../oanc_sentences_web.json         small coverage set for web tools (NGSL/NAWL/TSL words)
        ../oanc_wordfreq_written.csv       lemma frequency list (written English, by genre)
        ../oanc_wordfreq_spoken.csv        word frequency list (spoken English)
        ../oanc_collocations.json          word-partner statistics (logDice) by part of speech
        ../oanc_collocations_web.json      slimmer version for the NGSL/NAWL/TSL words
        ../oanc_report.json                counts and checks from this run

Run   : python build_oanc.py            (full build)
        python build_oanc.py --limit 300  (quick test on 300 files)

Needs : Python 3, nltk (with the averaged perceptron tagger and punkt_tab data). No other downloads.
Source: OANC, https://anc.org/data/oanc/  (unrestricted use, including commercial; credit the ANC).
"""
import collections
import csv
import json
import math
import multiprocessing as mp
import os
import random
import re
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../vocab collections
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'text', 'OANC-GrAF', 'data')
BUILD = os.path.join(HERE, 'build')
LIMIT = None
if '--limit' in sys.argv:
    LIMIT = int(sys.argv[sys.argv.index('--limit') + 1])

# folder (relative to data/) -> (source, genre). Biomedical journals (biomed, plos) are left out on purpose.
SOURCES = [
    ('written_1/journal/slate', 'slate', 'magazine'),
    ('written_1/journal/verbatim', 'verbatim', 'academic'),
    ('written_2/non-fiction', 'oup', 'academic'),
    ('written_2/travel_guides', 'berlitz', 'travel'),
    ('written_2/technical/government', 'government', 'government'),
    ('written_2/technical/911report', '911report', 'government'),
    ('written_1/fiction', 'eggan', 'fiction'),
    ('written_1/letters', 'icic', 'letters'),
]
GENRES = ['magazine', 'academic', 'travel', 'government', 'fiction', 'letters']
SPOKEN = ['spoken/face-to-face', 'spoken/telephone']

# per-source caps for the learner set, so one source (Slate) does not swamp the rest
LEARNER_CAP = {'slate': 60000, 'verbatim': 15000, 'oup': 8000, 'berlitz': 25000,
               'government': 22000, '911report': 0, 'eggan': 2500, 'icic': 0}
WEB_PER_WORD = 6

# ---------------------------------------------------------------- text cleaning

BLOCK = re.compile(
    r"\b(fuck\w*|shit\w*|bitch\w*|bastard\w*|asshole\w*|dick\w*|cock\w*|pussy|cunt\w*|slut\w*|whore\w*|"
    r"nigg\w*|fag\w*|retard\w*|sex|sexy|sexual\w*|sexes|rape\w*|rapist\w*|porn\w*|nude\w*|naked|orgasm\w*|"
    r"erotic\w*|prostitut\w*|genital\w*|penis|vagina\w*|condom\w*|masturbat\w*|molest\w*|incest\w*|"
    r"damn\w*|crap|piss\w*|screw\w*|suicid\w*|lust|lusty|boobs?|nipple\w*|testicle\w*|semen|abortion\w*)\b",
    re.I)
DATED = re.compile(
    r"\b(Slate|Prudie|Prudence|Clinton\w*|Dole|Gingrich|Lewinsky|Nixon|Bush|Gore|Perot|Yeltsin|Whitewater|"
    r"Kremlin|Saddam|Hussein|Reagan|Watergate|Iraqis?|Republicans?|Democrats?|Congress|Senate|Pentagon|"
    r"Bosnia\w*|Serb\w*|Taliban|Qaeda|Bin Ladin|terroris\w*|hijack\w*)\b")
BAD_CHARS = re.compile(r"[<>{}\[\]\\|_*#=~^@]|https?:|www\.|�")
ABBREV_END = re.compile(r"\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Inc|Co|vs|etc|No|Mt|Gen|Sen|Rep|Gov|Prof|U\.S|Lt|Col|Sgt)\.$")
MISSING_SPACE = re.compile(r"(?<=[a-z]{3}[.!?])(?=[A-Z][a-z])")


def decode(path):
    raw = open(path, 'rb').read()
    try:
        t = raw.decode('utf-8')
    except UnicodeDecodeError:
        t = raw.decode('cp1252', errors='replace')
    return t


def normalise(t):
    t = t.replace('\r\n', '\n').replace('\r', '\n')
    for a, b in (('‘', "'"), ('’', "'"), ('“', '"'), ('”', '"'), (' ', ' '),
                 ('\u2013', ' - '), ('\u2014', ' - '), ('\u2026', '...'), ('--', ' - ')):
        t = t.replace(a, b)
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", ' ', t)


def paragraphs(text):
    """Re-join hard-wrapped lines into paragraphs, dropping headings and short fragments."""
    lines = [l.strip() for l in text.split('\n')]
    n = len(lines)
    paras, cur = [], []

    def flush():
        if cur:
            p = re.sub(r'\s+', ' ', ' '.join(cur)).strip()
            if len(p) >= 40:
                paras.append(p)
            cur.clear()

    for i, l in enumerate(lines):
        if not l:
            flush()
            continue
        prev = lines[i - 1] if i else ''
        nxt = lines[i + 1] if i + 1 < n else ''
        heading = (len(l) < 90 and not re.search(r"[.!?:;,\"')]$", l) and re.match(r"[A-Z0-9]", l)
                   and (not prev or re.search(r"[.!?\"']$", prev)) and (not nxt or re.match(r"[A-Z\"']", nxt)))
        if heading or (len(l) < 100 and l.upper() == l and re.search(r'[A-Z]', l)):
            flush()
            continue
        cur.append(l)
    flush()
    return paras


_sent_tok = None


def split_sentences(par):
    global _sent_tok
    if _sent_tok is None:
        import nltk
        _sent_tok = nltk.sent_tokenize
    out = []
    for s in _sent_tok(par):
        out.extend(x.strip() for x in MISSING_SPACE.split(s))
    return [s for s in out if s]


def basic_ok(s, lo=5, hi=40, strict=True):
    """Cheap checks shared by every output. strict=True is for learner sentences, False for the statistics."""
    w = s.split()
    n = len(w)
    if n < lo or n > hi:
        return 0
    if not re.match(r"[\"']?[A-Z]", s) or not re.search(r"[.!?][\"')]?$", s):
        return 0
    if ABBREV_END.search(s) or BAD_CHARS.search(s):
        return 0
    letters = sum(c.isalpha() for c in s)
    if letters < (0.78 if strict else 0.65) * len(s.replace(' ', '')):
        return 0
    if sum(1 for c in s if c.isupper()) > (0.3 if strict else 0.4) * letters:
        return 0
    if strict:
        if s.count('(') != s.count(')') or s.count('"') % 2:
            return 0
        if sum(1 for x in w if re.search(r'\d', x)) > max(1, n // 5):
            return 0
    # tokenised or garbled text: space before punctuation, stray single letters, repeated words
    if re.search(r" [.,;:!?]", s) or re.search(r"\b[b-hj-zB-HJ-Z]\b(?!\.)", s) or re.search(r"\b(\w+) \1\b", s, re.I):
        return 0
    return n


def read_file(args):
    path, source, genre = args
    out = []
    for par in paragraphs(normalise(decode(path))):
        for s in split_sentences(par):
            if basic_ok(s, hi=60, strict=False):
                out.append((source, genre, s, bool(basic_ok(s))))
    return out


def list_files(folder):
    res = []
    for root, _, files in os.walk(os.path.join(DATA, folder)):
        for f in sorted(files):
            if f.endswith('.txt'):
                res.append(os.path.join(root, f))
    return sorted(res)


# ---------------------------------------------------------------- stage A: sentences

def stage_a():
    t0 = time.time()
    jobs = []
    for folder, source, genre in SOURCES:
        files = list_files(folder)
        if LIMIT:
            files = files[:max(1, LIMIT // len(SOURCES))]
        jobs += [(f, source, genre) for f in files]
    print(f'A: {len(jobs)} files', flush=True)
    seen, rows = set(), []
    with mp.Pool(max(1, mp.cpu_count() - 1)) as pool:
        for res in pool.imap(read_file, jobs, chunksize=4):
            for source, genre, s, strict in res:
                key = re.sub(r'\W+', ' ', s.lower()).strip()
                if key in seen:
                    continue
                seen.add(key)
                rows.append((source, genre, s, strict))
    print(f'A: {len(rows)} unique sentences ({time.time() - t0:.0f}s)', flush=True)
    return rows


# ---------------------------------------------------------------- lemmas and tags

IRREGULAR_TXT = """
be:am,is,are,was,were,been,being|have:has,had,having|do:does,did,done,doing|go:goes,went,gone,going|
make:makes,made,making|take:takes,took,taken,taking|give:gives,gave,given,giving|get:gets,got,gotten,getting|
come:comes,came,coming|see:sees,saw,seen,seeing|know:knows,knew,known,knowing|think:thinks,thought,thinking|
say:says,said,saying|tell:tells,told,telling|find:finds,found,finding|bring:brings,brought,bringing|
buy:buys,bought,buying|hold:holds,held,holding|keep:keeps,kept,keeping|leave:leaves,left,leaving|
lose:loses,lost,losing|meet:meets,met,meeting|pay:pays,paid,paying|put:puts,putting|run:runs,ran,running|
set:sets,setting|sit:sits,sat,sitting|stand:stands,stood,standing|understand:understands,understood,understanding|
win:wins,won,winning|write:writes,wrote,written,writing|begin:begins,began,begun,beginning|
break:breaks,broke,broken,breaking|build:builds,built,building|choose:chooses,chose,chosen,choosing|
draw:draws,drew,drawn,drawing|drive:drives,drove,driven,driving|eat:eats,ate,eaten,eating|
fall:falls,fell,fallen,falling|feel:feels,felt,feeling|fight:fights,fought,fighting|grow:grows,grew,grown,growing|
hear:hears,heard,hearing|hit:hits,hitting|lead:leads,led,leading|let:lets,letting|read:reads,reading|
rise:rises,rose,risen,rising|sell:sells,sold,selling|send:sends,sent,sending|show:shows,showed,shown,showing|
speak:speaks,spoke,spoken,speaking|spend:spends,spent,spending|teach:teaches,taught,teaching|
throw:throws,threw,thrown,throwing|wear:wears,wore,worn,wearing|cut:cuts,cutting|forget:forgets,forgot,forgotten,forgetting|
catch:catches,caught,catching|pick:picks,picked,picking|become:becomes,became,becoming|bear:bears,bore,borne,bearing|
beat:beats,beaten,beating|bend:bends,bent,bending|bet:bets,betting|bind:binds,bound,binding|bite:bites,bit,bitten,biting|
blow:blows,blew,blown,blowing|burn:burns,burnt,burning|burst:bursts,bursting|cast:casts,casting|cost:costs,costing|
creep:creeps,crept,creeping|deal:deals,dealt,dealing|dig:digs,dug,digging|dream:dreams,dreamt,dreaming|
drink:drinks,drank,drunk,drinking|fly:flies,flew,flown,flying|forbid:forbids,forbade,forbidden,forbidding|
forgive:forgives,forgave,forgiven,forgiving|freeze:freezes,froze,frozen,freezing|hang:hangs,hung,hanging|
hide:hides,hid,hidden,hiding|hurt:hurts,hurting|kneel:kneels,knelt,kneeling|lay:lays,laid,laying|
lend:lends,lent,lending|light:lights,lit,lighting|mean:means,meant,meaning|ride:rides,rode,ridden,riding|
ring:rings,rang,rung,ringing|seek:seeks,sought,seeking|shake:shakes,shook,shaken,shaking|shoot:shoots,shot,shooting|
shut:shuts,shutting|sing:sings,sang,sung,singing|sink:sinks,sank,sunk,sinking|sleep:sleeps,slept,sleeping|
slide:slides,slid,sliding|spin:spins,spun,spinning|split:splits,splitting|spread:spreads,spreading|
steal:steals,stole,stolen,stealing|stick:sticks,stuck,sticking|strike:strikes,struck,striking|swear:swears,swore,sworn,swearing|
sweep:sweeps,swept,sweeping|swim:swims,swam,swum,swimming|swing:swings,swung,swinging|tear:tears,tore,torn,tearing|
wake:wakes,woke,woken,waking|weep:weeps,wept,weeping|wind:winds,wound,winding|withdraw:withdraws,withdrew,withdrawn,withdrawing|
undertake:undertakes,undertook,undertaken,undertaking|overcome:overcomes,overcame,overcoming|
upset:upsets,upsetting|rebuild:rebuilds,rebuilt,rebuilding|rethink:rethinks,rethought,rethinking|
foresee:foresees,foresaw,foreseen,foreseeing|mistake:mistakes,mistook,mistaken,mistaking|
outdo:outdoes,outdid,outdone,outdoing|oversee:oversees,oversaw,overseen,overseeing|
"""
IRR_VERB = {}
for chunk in IRREGULAR_TXT.replace('\n', '').split('|'):
    if ':' in chunk:
        base, forms = chunk.split(':')
        for f in forms.split(','):
            IRR_VERB.setdefault(f, base)
IRR_NOUN = {'men': 'man', 'women': 'woman', 'children': 'child', 'feet': 'foot', 'teeth': 'tooth', 'mice': 'mouse',
            'geese': 'goose', 'lives': 'life', 'wives': 'wife', 'knives': 'knife', 'leaves': 'leaf', 'halves': 'half',
            'wolves': 'wolf', 'shelves': 'shelf', 'thieves': 'thief', 'criteria': 'criterion',
            'phenomena': 'phenomenon', 'analyses': 'analysis', 'crises': 'crisis', 'hypotheses': 'hypothesis',
            'theses': 'thesis', 'indices': 'index', 'stimuli': 'stimulus', 'bacteria': 'bacterium',
            'fungi': 'fungus', 'nuclei': 'nucleus', 'curricula': 'curriculum', 'oxen': 'ox', 'dice': 'die',
            'selves': 'self', 'loaves': 'loaf', 'elves': 'elf', 'heroes': 'hero', 'potatoes': 'potato',
            'tomatoes': 'tomato', 'echoes': 'echo', 'vetoes': 'veto'}
IRR_ADJ = {'better': 'good', 'best': 'good', 'worse': 'bad', 'worst': 'bad', 'further': 'far', 'furthest': 'far',
           'farther': 'far', 'farthest': 'far', 'elder': 'old', 'eldest': 'old'}

POS_OF = {}
for tag in ('NN', 'NNS'):
    POS_OF[tag] = 'NOUN'
for tag in ('VB', 'VBD', 'VBG', 'VBN', 'VBP', 'VBZ'):
    POS_OF[tag] = 'VERB'
for tag in ('JJ', 'JJR', 'JJS'):
    POS_OF[tag] = 'ADJ'
for tag in ('RB', 'RBR', 'RBS'):
    POS_OF[tag] = 'ADV'
POS_OF.update({'IN': 'PREP', 'TO': 'PREP', 'RP': 'PART', 'DT': 'DET', 'PDT': 'DET', 'PRP$': 'DET', 'WDT': 'DET',
               'WP$': 'DET', 'PRP': 'PRON', 'WP': 'PRON', 'CC': 'CONJ', 'MD': 'MODAL', 'UH': 'INTJ', 'EX': 'EX',
               'WRB': 'ADV'})

VOCAB = {}


def pick(cands, default):
    best, bf = default, 0
    for c in cands:
        f = VOCAB.get(c, 0)
        if f > bf:
            best, bf = c, f
    return best


def undouble(stem):
    return [stem[:-1]] if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in 'aeiouls' else []


def lemmatise(w, tag):
    pos = POS_OF.get(tag)
    if pos == 'NOUN' and tag == 'NNS':
        if w in IRR_NOUN:
            return IRR_NOUN[w]
        c = []
        if w.endswith('ies'):
            c.append(w[:-3] + 'y')
        if w.endswith('es'):
            c.append(w[:-2])
        if w.endswith('s'):
            c.append(w[:-1])
        return pick(c, w)
    if pos == 'VERB' and tag != 'VB' and tag != 'VBP':
        if w in IRR_VERB:
            return IRR_VERB[w]
        c = []
        if tag == 'VBZ':
            if w.endswith('ies'):
                c.append(w[:-3] + 'y')
            if w.endswith('es'):
                c.append(w[:-2])
            if w.endswith('s'):
                c.append(w[:-1])
        elif tag in ('VBD', 'VBN'):
            if w.endswith('ied'):
                c.append(w[:-3] + 'y')
            if w.endswith('ed'):
                c += [w[:-2], w[:-1]] + undouble(w[:-2])
        elif tag == 'VBG' and w.endswith('ing'):
            s = w[:-3]
            c += [s, s + 'e'] + undouble(s)
        return pick(c, w)
    if pos == 'VERB' and tag == 'VBP' and w in ('are', 'am'):
        return 'be'
    if pos == 'ADJ' and tag in ('JJR', 'JJS'):
        if w in IRR_ADJ:
            return IRR_ADJ[w]
        c = []
        for suf, rep in (('ier', 'y'), ('iest', 'y'), ('er', ''), ('est', ''), ('r', ''), ('st', '')):
            if w.endswith(suf):
                s = w[:-len(suf)] + rep
                c += [s, s + 'e'] + undouble(s)
        return pick(c, w)
    return w


_tok = None
_tag = None


def tag_tokens(s):
    global _tok, _tag
    if _tok is None:
        import nltk
        from nltk.tokenize import NLTKWordTokenizer
        _tok = NLTKWordTokenizer().tokenize
        _tag = nltk.pos_tag
    return _tag(_tok(s))


# ---------------------------------------------------------------- stage B: tag, count, relations

REL_SKIP_VERBS = {'be', 'have', 'do'}


def init_worker(vocab):
    global VOCAB
    VOCAB = vocab


def analyse_chunk(chunk):
    """chunk: list of (idx, genre, sentence, want_lemmas). Returns counters and lemma sets."""
    freq = collections.Counter()      # (lemma, pos, genre) -> n
    rel = collections.Counter()       # (rel, a, b) -> n
    lemmas = {}
    for idx, genre, s, want in chunk:
        toks = tag_tokens(s)
        items = []  # (lemma, pos) per token, None for tokens we ignore
        for i, (w, tg) in enumerate(toks):
            pos = POS_OF.get(tg)
            if not pos or not re.match(r"^[A-Za-z][A-Za-z'-]*$", w):
                items.append(None)
                continue
            wl = w.lower()
            if wl in ("n't", "'s", "'re", "'ve", "'ll", "'d", "'m") or tg in ('NNP', 'NNPS'):
                items.append(None)
                continue
            lem = lemmatise(wl, tg)
            items.append((lem, pos))
            freq[(lem, pos, genre)] += 1
        n = len(items)
        for i in range(n):
            a = items[i]
            if not a:
                continue
            lem, pos = a
            nxt = items[i + 1] if i + 1 < n else None
            if nxt:
                l2, p2 = nxt
                if pos == 'ADJ' and p2 == 'NOUN':
                    rel[('JN', lem, l2)] += 1
                elif pos == 'NOUN' and p2 == 'NOUN':
                    rel[('NN', lem, l2)] += 1
                elif pos == 'ADV' and p2 == 'ADJ':
                    rel[('RJ', lem, l2)] += 1
                elif pos == 'ADV' and p2 == 'VERB' and l2 not in REL_SKIP_VERBS:
                    rel[('RV', lem, l2)] += 1
                elif pos == 'VERB' and p2 == 'ADV' and lem not in REL_SKIP_VERBS and toks[i + 1][0].lower().endswith('ly'):
                    rel[('RV', l2, lem)] += 1
                elif pos == 'VERB' and p2 in ('PREP', 'PART') and lem not in REL_SKIP_VERBS:
                    rel[('VP', lem, l2)] += 1
                elif pos == 'ADJ' and p2 == 'PREP':
                    rel[('JP', lem, l2)] += 1
                elif pos == 'NOUN' and p2 == 'PREP':
                    rel[('NP', lem, l2)] += 1
            adjectival = toks[i][1] in ('VBN', 'VBG') and i > 0 and toks[i - 1][1] in (
                'DT', 'PRP$', 'JJ', 'JJR', 'JJS', 'CD', 'POS', 'PDT')
            if pos == 'VERB' and lem not in REL_SKIP_VERBS and not adjectival:
                # verb + (determiner / adjective / number)* + noun  -> object noun
                j = i + 1
                while j < n and j <= i + 4:
                    tg = toks[j][1]
                    if tg in ('DT', 'PRP$', 'JJ', 'JJR', 'JJS', 'CD', 'PDT'):
                        j += 1
                        continue
                    if tg in ('NN', 'NNS') and items[j]:
                        rel[('VN', lem, items[j][0])] += 1
                    break
        if want:
            has_verb = any(tg.startswith('VB') or tg == 'MD' for _, tg in toks)
            n_proper = sum(1 for _, tg in toks if tg in ('NNP', 'NNPS'))
            lemmas[idx] = (sorted({f'{x[0]}' for x in items if x and x[1] in ('NOUN', 'VERB', 'ADJ', 'ADV')}),
                           has_verb, n_proper)
    return freq, rel, lemmas


def chunks(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


# ---------------------------------------------------------------- helpers

def open_out(path, **kw):
    """open() for writing, retrying a few times: Windows sometimes holds a freshly written file briefly."""
    for attempt in range(8):
        try:
            return open(path, 'w', encoding='utf-8', **kw)
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(1.5)


def dump(path, obj, **kw):
    with open_out(path) as fh:
        json.dump(obj, fh, ensure_ascii=False, **kw)


def logdice(fxy, fx, fy):
    return 14 + math.log2(2 * fxy / (fx + fy))


def load_wordlists():
    """Optional NGSL/NAWL/TSL word lists (ngsl.json, nawl.json, tsl.json next to the outputs).
    Without them the script still builds everything except the small 'web' coverage set, which needs a target list."""
    out = {}
    for name in ('ngsl', 'nawl', 'tsl'):
        path = os.path.join(BASE, name + '.json')
        if os.path.exists(path):
            out[name] = set(json.load(open(path, encoding='utf-8')).keys())
        else:
            out[name] = set()
    if not any(out.values()):
        print('note: no NGSL/NAWL/TSL lists found, skipping the target-word outputs', flush=True)
    return out


def main():
    os.makedirs(BUILD, exist_ok=True)
    t0 = time.time()
    rows = stage_a()                      # (source, genre, sentence)

    # vocabulary of the written corpus (for the "rare word" test and for lemma choice)
    vocab = collections.Counter()
    for _, _, s, _ in rows:
        vocab.update(w for w in re.findall(r"[a-z]+(?:'[a-z]+)?", s.lower()))
    vocab = dict(vocab)
    print(f'vocab {len(vocab)} forms', flush=True)

    def rare(s):
        r = 0
        toks = re.findall(r"[A-Za-z]+(?:'[a-z]+)?", s)
        for k, w in enumerate(toks):
            if k > 0 and w[0].isupper():
                continue
            if vocab.get(w.lower(), 0) < 15:
                r += 1
        return r

    learner_idx = []
    stats_rows = []
    for source, genre, s, strict in rows:
        n = len(s.split())
        learner = (strict and LEARNER_CAP.get(source, 0) > 0 and 8 <= n <= 22 and not BLOCK.search(s)
                   and not DATED.search(s)
                   and s.count(' - ') <= 1 and '...' not in s and not re.search(r'\d{3,}', s)
                   and rare(s) == 0)
        stats_rows.append((source, genre, s, learner))
    print(f'learner-eligible {sum(1 for r in stats_rows if r[3])}', flush=True)

    # ---- tag everything (parallel)
    jobs = [(i, g, s, learner) for i, (src, g, s, learner) in enumerate(stats_rows)]
    freq, rel, lemmas = collections.Counter(), collections.Counter(), {}
    with mp.Pool(max(1, mp.cpu_count() - 1), initializer=init_worker, initargs=(vocab,)) as pool:
        done = 0
        for f, r, lm in pool.imap_unordered(analyse_chunk, list(chunks(jobs, 1500))):
            freq.update(f)
            rel.update(r)
            lemmas.update(lm)
            done += 1
            if done % 20 == 0:
                print(f'  tagged {done * 1500} sentences ({time.time() - t0:.0f}s)', flush=True)
    print(f'B: freq {len(freq)}, relations {len(rel)} ({time.time() - t0:.0f}s)', flush=True)

    total_tokens = sum(freq.values())
    # ---- frequency list (written)
    agg = collections.defaultdict(lambda: collections.Counter())
    for (lem, pos, g), c in freq.items():
        agg[(lem, pos)][g] += c
    lemma_pos_total = {k: sum(v.values()) for k, v in agg.items()}
    rows_f = []
    for (lem, pos), gc in agg.items():
        c = lemma_pos_total[(lem, pos)]
        if c < 3:
            continue
        rows_f.append([lem, pos, c, round(c / total_tokens * 1e6, 2), sum(1 for g in GENRES if gc[g]) ] +
                      [gc[g] for g in GENRES])
    rows_f.sort(key=lambda r: (-r[2], r[0], r[1]))
    with open_out(os.path.join(BASE, 'oanc_wordfreq_written.csv'), newline='') as fh:
        wr = csv.writer(fh, lineterminator="\n")
        wr.writerow(['lemma', 'pos', 'count', 'per_million', 'genres_present'] + ['n_' + g for g in GENRES])
        wr.writerows(rows_f)

    # ---- collocations
    REL = {  # code -> (head pos, head is 'a' or 'b', label, partner pos)
        'JN': [('ADJ', 'a', 'noun', 'NOUN'), ('NOUN', 'b', 'adj', 'ADJ')],
        'NN': [('NOUN', 'a', 'noun_after', 'NOUN'), ('NOUN', 'b', 'noun_before', 'NOUN')],
        'VN': [('VERB', 'a', 'noun_object', 'NOUN'), ('NOUN', 'b', 'verb', 'VERB')],
        'RJ': [('ADV', 'a', 'adj', 'ADJ'), ('ADJ', 'b', 'adv', 'ADV')],
        'RV': [('ADV', 'a', 'verb', 'VERB'), ('VERB', 'b', 'adv', 'ADV')],
        'VP': [('VERB', 'a', 'prep_after', 'PREP')],
        'JP': [('ADJ', 'a', 'prep_after', 'PREP')],
        'NP': [('NOUN', 'a', 'prep_after', 'PREP')],
    }
    PREPLIKE = ('PREP', 'PART')

    def fpos(lem, pos):
        if pos == 'PREP':
            return lemma_pos_total.get((lem, 'PREP'), 0) + lemma_pos_total.get((lem, 'PART'), 0)
        return lemma_pos_total.get((lem, pos), 0)

    MIN_JOINT, MIN_HEAD, TOP = 3, 25, 15
    grouped = collections.defaultdict(lambda: collections.defaultdict(list))
    for (code, a, b), c in rel.items():
        if c < MIN_JOINT:
            continue
        for hpos, side, label, ppos in REL[code]:
            head, partner = (a, b) if side == 'a' else (b, a)
            fx, fy = fpos(head, hpos), fpos(partner, ppos)
            if fx < MIN_HEAD or fy < 5:
                continue
            grouped[(head, hpos)][label].append([partner, c, round(logdice(c, fx, fy), 2)])
    entries = {}
    for (head, hpos), labels in sorted(grouped.items()):
        d = {'freq': lemma_pos_total[(head, hpos)]}
        for label, lst in sorted(labels.items()):
            lst.sort(key=lambda x: (-x[2], -x[1], x[0]))
            d[label] = lst[:TOP]
        entries.setdefault(head, {})[hpos] = d
    meta = {'source': 'Open American National Corpus (OANC), https://anc.org/data/oanc/',
            'genres': GENRES, 'tokens_counted': total_tokens,
            'measure': 'logDice = 14 + log2(2*f(xy)/(f(x)+f(y))); each partner is [lemma, joint count, logDice]',
            'min_joint_count': MIN_JOINT, 'min_head_frequency': MIN_HEAD,
            'relations': 'noun: adj, verb, noun_before, noun_after, prep_after | verb: noun_object, adv, prep_after | '
                         'adj: noun, adv, prep_after | adv: adj, verb',
            'note': 'Surface-pattern statistics from automatic part-of-speech tagging, not hand-checked.'}
    dump(os.path.join(BASE, 'oanc_collocations.json'), {'meta': meta, 'entries': entries}, separators=(',', ':'))

    wl = load_wordlists()
    targets = wl['ngsl'] | wl['nawl'] | wl['tsl']
    web = {}
    for head, byp in sorted(entries.items()):
        if head not in targets:
            continue
        w = {}
        for hpos, d in byp.items():
            w[hpos] = {k: ([[p, c] for p, c, _ in v[:8]] if isinstance(v, list) else v) for k, v in d.items()}
        web[head] = w
    dump(os.path.join(BASE, 'oanc_collocations_web.json'),
         {'meta': dict(meta, trimmed='NGSL, NAWL and TSL headwords only, top 8 partners, [lemma, count]'), 'entries': web},
         separators=(',', ':'))

    # ---- learner sentences (capped per source, reproducible shuffle)
    rnd = random.Random(20261101)
    by_source = collections.defaultdict(list)
    for i, (src, g, s, learner) in enumerate(stats_rows):
        # needs a verb (not a fragment) and at most two proper names
        if learner and i in lemmas and lemmas[i][1] and lemmas[i][2] <= 2:
            by_source[src].append(i)
    chosen = []
    for src, idxs in by_source.items():
        rnd.shuffle(idxs)
        chosen += idxs[:LEARNER_CAP[src]]
    chosen.sort()
    learner_out = [{'s': stats_rows[i][2], 'g': stats_rows[i][1]} for i in chosen]
    dump(os.path.join(BASE, 'oanc_sentences_learner.json'), learner_out, separators=(',', ':'))

    # ---- web coverage set: up to N sentences per NGSL/NAWL/TSL word, rare words first
    have = collections.defaultdict(list)
    chosen_set = set(chosen)
    for i in chosen:
        for lem in lemmas[i][0]:
            if lem in targets:
                have[lem].append(i)
    picked, count_for = set(), collections.Counter()
    for lem in sorted(have, key=lambda k: len(have[k])):
        cands = sorted(have[lem], key=lambda i: (abs(len(stats_rows[i][2].split()) - 15), i))
        for i in cands:
            if count_for[lem] >= WEB_PER_WORD:
                break
            if i in picked:
                count_for[lem] += 1
                continue
            picked.add(i)
            for l2 in lemmas[i][0]:
                count_for[l2] += 1
    web_out = [{'s': stats_rows[i][2], 'g': stats_rows[i][1]} for i in sorted(picked)]
    dump(os.path.join(BASE, 'oanc_sentences_web.json'), web_out, separators=(',', ':'))
    covered = sum(1 for lem in targets if count_for[lem] > 0)

    # ---- spoken frequency list
    sp = collections.Counter()
    for folder in SPOKEN:
        files = list_files(folder)
        if LIMIT:
            files = files[:max(1, LIMIT // 4)]
        for f in files:
            for line in decode(f).split('\n'):
                sp.update(re.findall(r"[a-z]+(?:[-'][a-z]+)*", line.lower()))
    sp_total = sum(sp.values())
    with open_out(os.path.join(BASE, 'oanc_wordfreq_spoken.csv'), newline='') as fh:
        wr = csv.writer(fh, lineterminator="\n")
        wr.writerow(['word', 'count', 'per_million'])
        for w, c in sp.most_common():
            if c >= 5:
                wr.writerow([w, c, round(c / sp_total * 1e6, 2)])

    report = {'built': time.strftime('%Y-%m-%d %H:%M'), 'limit': LIMIT,
              'unique_written_sentences': len(rows), 'learner_eligible_before_checks': sum(1 for r in stats_rows if r[3]),
              'learner_written': len(learner_out), 'web_sentences': len(web_out),
              'target_words': len(targets), 'target_words_with_example': covered,
              'written_tokens_counted': total_tokens, 'spoken_tokens': sp_total,
              'frequency_rows': len(rows_f), 'collocation_headwords': len(entries),
              'collocation_headwords_web': len(web), 'seconds': round(time.time() - t0)}
    dump(os.path.join(BASE, 'oanc_report.json'), report, indent=2)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    mp.freeze_support()
    main()
