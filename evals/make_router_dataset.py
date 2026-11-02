"""Writes evals/router_dataset.jsonl for the prompt router and validates it.

Classes: retrieve (needs the docs), chitchat (greetings, small talk, gibberish), about_bot, out_of_scope (non-infra).
Rows = reviewed seeds (evals/router_seeds.jsonl) + drafted rows below + retrieve rows derived from the corpus + deterministic variants.
Split is by group (a seed and its variants always share a split): sha1(group) % 10 -> 0-5 train, 6-7 val, 8-9 test.
Needs embeddings/chunks.jsonl (heading-derived rows) and data/terraform/aws/r (identifiers); the output is committed.
Rule for edge cases: any infra request in the prompt means retrieve; when unsure, retrieve (a wrong skip is worse than a wasted search).
"""
import hashlib, json, os, random, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("FASTEMBED_CACHE_PATH", str(ROOT / "models"))

RETRIEVE = [  # (text, kind)
 *[(t, "hard") for t in ["ingress?", "helm", "what is kubernetes", "what is docker", "terraform state", "kubectl", "pods", "what is a pod",
    "docker compose", "iam roles", "s3 bucket policy", "what is eks", "ecs vs eks", "alb vs nlb", "cloudfront cache", "rds backup",
    "vpc peering", "security groups", "what's a daemonset", "configmap", "taints", "dockerfile cmd vs entrypoint", "terraform import",
    "terraform workspace", "docker volume", "depends_on", "for_each", "service accounts", "what is a statefulset", "cidr blocks"]],
 *[(t, "error") for t in ["CrashLoopBackOff", "OOMKilled", "ImagePullBackOff", "ErrImagePull", "Back-off restarting failed container",
    "exec format error", "Error: Invalid provider configuration", "pull access denied for myimage, repository does not exist",
    "The connection to the server localhost:8080 was refused", "Error from server (Forbidden): pods is forbidden",
    "0/3 nodes are available: 3 Insufficient cpu", "Error: creating EC2 Instance: UnauthorizedOperation",
    "An error occurred (AccessDenied) when calling the PutObject operation",
    "Got permission denied while trying to connect to the Docker daemon socket", "no space left on device docker",
    "OCI runtime create failed: container_linux.go", "Error: Cycle: aws_security_group.a, aws_security_group.b",
    "failed to solve: process did not complete successfully: exit code: 1", "my container exits with code 137", "pod stuck in Pending",
    "node NotReady", "503 Service Temporarily Unavailable ingress", "Error: Unsupported argument", "kubectl get pods shows Evicted",
    "ELB health checks failing", "Error: Failed to query available provider packages", "x509: certificate signed by unknown authority"]],
 *[(t, "vague") for t in ["app is slow after deploy", "why can't my container reach the internet", "service not reachable from outside the cluster",
    "can't connect to rds from my laptop", "terraform wants to destroy everything", "docker build is really slow", "cluster costs too much",
    "pods won't schedule", "my deployment is stuck", "terraform apply hangs", "ec2 instance not reachable by ssh", "load balancer returns 502",
    "container keeps restarting"]],
 *[(t, "multi") for t in ["thanks! also how do I scale a deployment", "hello can you explain terraform modules",
    "hey whats the difference between a pod and a deployment", "ok cool, now how do I roll back", "good morning, my pod is in CrashLoopBackOff",
    "thank you. one more thing: how do I set resource limits", "hi! what is an IAM role", "yo how do i expose a service in k8s",
    "how are you? I need help with a docker build error", "hey, quick question about security groups"]],
 *[(t, "typo") for t in ["terrafrom plan not working", "dockr compose up", "TERRAFORM PLAN", "KUBECTL GET PODS",
    "how do i creat an s3 bukcet in terraform", "k8s ingres controller", "dockerfle multi stage"]],
 *[(t, "nonenglish") for t in ["comment créer un bucket s3 avec terraform", "wie erstelle ich ein Dockerfile", "kubernetes में pod कैसे restart करें",
    "como configurar um security group na aws", "¿qué es un deployment en kubernetes?"]],
 *[(t, "hard") for t in ["what model does EKS use for the node AMI", "how do I deploy a container on ECS", "which docs explain IAM",
    "what gets deployed when I create an EKS cluster", "where are docker images stored", "what can I use for container orchestration",
    "is docker hub free", "python docker sdk", "how do I set up ci/cd for terraform", "how do I check which port a service is listening on",
    "dns not resolving inside a pod", "what's the difference between a vm and a container", "which cloud region should I pick for latency"]],
]
CHITCHAT = ["hello", "hey", "good morning", "good evening", "yo", "sup", "howdy", "hello?", "hi!!", "how are you doing",
    "how's it going", "how do you feel today", "how is your day going", "are you ok", "whats good", "nice to meet you",
    "long time no see", "happy friday", "how have you been", "thanks", "thank you", "thank you so much!!", "thx", "ty", "cheers",
    "appreciate it", "great", "awesome", "perfect", "ok", "okay", "got it", "nice", "cool", "goodbye", "see you", "see ya",
    "lol", "haha", "hmm", "...", "test", "testing 123", "hello?? anyone there", "qwerty", "good afternoon", "greetings", "thanks a lot, bye",
    "kjhgf", "zzzz", "!!!", "uhh", "aaaa", "blah blah", "hola", "namaste", "wassup", "what's new", "you there?"]
ABOUT = ["are you open source", "what sources do you use", "which embedding model do you use", "how do you find answers", "what's your name",
    "do you remember previous questions", "can you browse the internet", "what version are you", "are you an ai", "how accurate are you",
    "what is OpsRAG", "do you use GPT", "what is your knowledge cutoff", "how are you built", "tell me about yourself", "what are you",
    "what topics can you answer", "what's your tech stack", "where do your answers come from", "are your answers cited",
    "what is your purpose", "which reranker do you use", "do you use RAG", "are you running locally", "do you hallucinate",
    "how do you cite sources", "is this tool free", "what hosting do you run on", "which cloud are you on", "what's the model behind you",
    "how were you trained", "which LLM are you", "what language model is this", "who built this", "what data do you have",
    "are you connected to the internet", "can you remember me", "what are your limitations", "which documentation do you cover",
    "what's your context window", "how do you rank results", "are you better than chatgpt", "what are you good at", "what can I ask you", "how can you help me", "what are your capabilities",
    "do you have access to my aws account", "can you run commands for me", "do you learn from my questions", "what are you trained on",
    "is this an official aws tool", "which company built you", "what do you know about"]
OUT_OF_SCOPE = ["what is the capital of australia", "recommend a good movie", "tell me a joke", "what time is it in tokyo", "translate hello to french",
    "how many calories in a banana", "who is the president of france", "what is 15 times 23", "how do I lose weight", "explain quantum physics",
    "what is the meaning of life", "write a cover letter for me", "how do I fix my bike chain", "best laptop under 1000 dollars",
    "who is taylor swift", "how do I learn guitar", "what is the speed of light", "sort an array in javascript", "how do I center a div in css",
    "how do I train a neural network", "how do I invest in bitcoin", "latest iphone release date", "can you play chess",
    "what's a good name for my dog", "how do I get a visa for canada", "help me with my homework on photosynthesis", "give me a workout plan",
    "what is the stock price of tesla", "who invented the telephone", "how do I cook rice", "is it going to rain tomorrow",
    "what is the population of india", "fix this python error: IndexError: list index out of range", "write a haiku", "what is blockchain",
    "how do I bake a cake", "which football team is the best", "what's the weather today", "what is the best pizza topping",
    "how do I write a resume", "summarize the plot of hamlet", "what is the tallest mountain", "how do I meditate", "who won the ipl this year",
    "how do I start a youtube channel", "what is inflation", "write a python function to check for palindromes", "how long does it take to fly to london",
    "what's the temperature in delhi", "explain the french revolution", "how to tie a tie", "best way to learn spanish",
    "write a java class for a bank account", "how do I use pandas to read a csv", "what is the difference between a list and a tuple in python",
    "who is the richest person in the world", "how do I plant tomatoes", "recommend a podcast", "what is a good birthday gift for my mom",
    "when is the next full moon", "how does a car engine work", "what causes headaches", "how do I write a for loop in c++",
    "who wrote pride and prejudice", "convert 100 fahrenheit to celsius", "best restaurants in mumbai", "how do I train for a marathon"]

GENERIC = {"example usage", "argument reference", "attribute reference", "what's next", "before you begin", "before you start", "see also",
           "related information", "prerequisites", "next steps", "import", "timeouts", "document history", "limitations", "overview", "synopsis"}
MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"}
VERBS = ("configure", "create", "use", "set up", "enable", "add", "delete", "update", "install", "run", "manage", "connect", "monitor", "scale")


def is_datelike(h):  # release-note date headings such as "June 30, 2025"
    ws = [w.strip(",.").lower() for w in h.split()]
    return any(w in MONTHS or (w.isdigit() and len(w) == 4) for w in ws)


def norm(t):
    return re.sub(r"\W+", " ", t.lower()).strip()


def split_of(group):
    b = int(hashlib.sha1(group.encode()).hexdigest(), 16) % 10
    return "train" if b < 6 else "val" if b < 8 else "test"


def variants(text, rng):
    """Deterministic surface variants; all share the seed's group, so they stay in one split."""
    out = [text]
    if text.lower() != text: out.append(text.lower())
    nop = re.sub(r"[?!.]+$", "", text).strip()
    if nop != text and nop: out.append(nop)
    words = [w for w in text.split() if len(w) > 4 and w.isascii() and w.isalpha()]
    if words and text.isascii():
        w = rng.choice(words); i = rng.randrange(1, len(w) - 2)
        out.append(text.replace(w, w[:i] + w[i + 1] + w[i] + w[i + 2:], 1))
    return list(dict.fromkeys(out))


def derived_retrieve(rng, avoid):
    rows, by_src = [], {}
    for line in open(ROOT / "embeddings" / "chunks.jsonl", encoding="utf-8"):
        c = json.loads(line)
        h = re.sub(r"\s*\{#[^}]*\}", "", c["heading"].split(" > ")[-1]).strip()
        if (12 <= len(h) <= 70 and 2 <= len(h.split()) <= 9 and re.fullmatch(r"[A-Za-z][A-Za-z0-9 _\-/.,()']+", h)
                and h.lower() not in GENERIC and not h.startswith(("Resource:", "Data Source:")) and not is_datelike(h)):
            by_src.setdefault(c["source"], set()).add(h)
    pools = {s: sorted(v) for s, v in by_src.items()}
    for p in pools.values(): rng.shuffle(p)
    picked = []
    while len(picked) < 130 and any(pools.values()):
        for s in sorted(pools):
            if pools[s]: picked.append(pools[s].pop())
    for h in picked:
        t = "how do I " + h[0].lower() + h[1:] if h.lower().startswith(VERBS) and rng.random() < 0.5 else h
        if norm(t) not in avoid: rows.append((t, "heading"))
    names = sorted(p.name.split(".")[0] for p in (ROOT / "data" / "terraform" / "aws" / "r").glob("*.markdown"))
    rng.shuffle(names)
    for i, n in enumerate(names[:40]):
        t = f"aws_{n}" if i < 28 else f"how do I use aws_{n}"
        if norm(t) not in avoid: rows.append((t, "identifier"))
    return rows


def build():
    rng = random.Random(42)
    eval_q = [json.loads(l)["question"] for l in open(ROOT / "evals" / "dataset.jsonl", encoding="utf-8")]
    avoid = {norm(q) for q in eval_q}
    reviewed = [json.loads(l) for l in open(ROOT / "evals" / "router_seeds.jsonl", encoding="utf-8") if l.strip()]
    seeds = [(r["text"], r["label"], "reviewed") for r in reviewed]
    seeds += [(t, "retrieve", k) for t, k in RETRIEVE] + [(t, "retrieve", k) for t, k in derived_retrieve(rng, avoid)]
    seeds += [(t, "chitchat", "plain") for t in CHITCHAT] + [(t, "about_bot", "plain") for t in ABOUT] + [(t, "out_of_scope", "plain") for t in OUT_OF_SCOPE]
    rows, seen = [], set()
    for text, label, kind in seeds:
        group = f"{label}:{norm(text)}"
        if group in seen or not norm(text) and label != "chitchat": continue
        seen.add(group)
        for i, v in enumerate(variants(text, random.Random(group))):
            rows.append({"text": v, "label": label, "group": group, "kind": kind if i == 0 else f"{kind}+variant", "split": split_of(group)})
    return rows, eval_q


def validate(rows, eval_q):
    import numpy as np
    from fastembed import TextEmbedding
    errs, owner = [], {}
    for r in rows:  # same normalised text in two different groups (or with two labels)
        k = norm(r["text"])
        if k and k in owner and owner[k] != r["group"]: errs.append(f"duplicate text across groups: {r['text']!r} vs {owner[k]}")
        owner.setdefault(k, r["group"])
    ev = {norm(q) for q in eval_q}
    errs += [f"overlaps a retrieval-eval question: {r['text']!r}" for r in rows if norm(r["text"]) in ev]
    for lab in {r["label"] for r in rows}:
        for sp in ("train", "val", "test"):
            n = sum(r["label"] == lab and r["split"] == sp for r in rows)
            if n < 15: errs.append(f"{lab}/{sp} has only {n} rows (need >= 15)")
    m = TextEmbedding("BAAI/bge-small-en-v1.5")
    E = np.array(list(m.embed([r["text"] for r in rows]))); Q = np.array(list(m.embed(eval_q)))
    E /= np.linalg.norm(E, axis=1, keepdims=True); Q /= np.linalg.norm(Q, axis=1, keepdims=True)
    S = np.triu(E @ E.T, 1)
    for i, j in zip(*np.where(S >= 0.95)):
        a, b = rows[i], rows[j]
        if a["split"] != b["split"]: errs.append(f"cross-split near-duplicate ({S[i, j]:.2f}): {a['text']!r} [{a['split']}/{a['label']}] vs {b['text']!r} [{b['split']}/{b['label']}]")
        elif a["label"] != b["label"]: errs.append(f"near-duplicate with different labels ({S[i, j]:.2f}): {a['text']!r} [{a['label']}] vs {b['text']!r} [{b['label']}]")
    EQ = E @ Q.T
    for i, j in zip(*np.where(EQ >= 0.95)):
        errs.append(f"near-duplicate of eval question ({EQ[i, j]:.2f}): {rows[i]['text']!r} vs {eval_q[j]!r}")
    return errs


if __name__ == "__main__":
    import collections
    rows, eval_q = build()
    errs = validate(rows, eval_q)
    for e in errs: print("INVALID:", e)
    if errs: sys.exit(1)
    (ROOT / "evals" / "router_dataset.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    print(len(rows), "rows;", len({r["group"] for r in rows}), "groups")
    for lab in ("retrieve", "chitchat", "about_bot", "out_of_scope"):
        print(f"  {lab:13}", {sp: sum(r['label'] == lab and r['split'] == sp for r in rows) for sp in ("train", "val", "test")})
    print("  retrieve kinds:", dict(collections.Counter(r["kind"].split("+")[0] for r in rows if r["label"] == "retrieve")))
