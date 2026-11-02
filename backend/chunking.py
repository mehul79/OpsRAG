"""Clean + chunk markdown docs by heading. Stdlib only, so it runs anywhere (laptop, Colab).

`python backend/chunking.py` runs a small self-check.
"""
import re, uuid
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
MAX_CHARS = 1500  # ~380 tokens, under bge-small's 512 limit
MIN_CHARS = 80
EXT = {".md", ".mdx", ".markdown"}


def source_of(path):
    parts = path.relative_to(DATA).parts
    if parts[0] == "terraform":
        return f"terraform-{parts[1]}"
    return f"aws-{parts[1]}" if parts[0] == "aws" else parts[0]


def clean(text):
    url = (re.match(r"<!-- source: (\S+) -->", text) or [None, None])[1]
    text = re.sub(r"\A(<!-- source: .*? -->\s*)?---\n.*?\n---\n", "", text, flags=re.S)  # front matter
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)           # html comments
    text = re.sub(r"\{\{[<%].*?[>%]\}\}", "", text, flags=re.S)  # hugo shortcodes (keep inner text)
    text = re.sub(r'<a name="[^"]*"></a>', "", text)            # aws anchors
    return text.strip(), url


def sections(text):
    """Yield (heading_path, body) split at h1-h3, ignoring '#' lines inside code fences."""
    path, body, fence = [], [], False
    def flush():
        if body:
            yield " > ".join(path), "\n".join(body).strip()
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            fence = not fence
        m = None if fence else re.match(r"^(#{1,3}) +(.+?)\s*#*$", line)
        if m:
            yield from flush()
            body = []
            level = len(m[1])
            path = path[:level - 1] + [m[2]]
        else:
            body.append(line)
    yield from flush()


def blocks(body):
    """Paragraphs, with fenced code kept whole (blank lines inside a fence don't split)."""
    out, cur, fence = [], [], False
    for line in body.splitlines():
        if line.lstrip().startswith("```"):
            fence = not fence
        if not line.strip() and not fence:
            if cur: out.append("\n".join(cur)); cur = []
        else:
            cur.append(line)
    if cur: out.append("\n".join(cur))
    return out


def split_block(blk):
    """Cut an oversized block on line boundaries; code pieces are re-fenced so each stays valid."""
    lines = blk.splitlines()
    fenced = lines[0].lstrip().startswith("```")
    if fenced:
        opener, lines = lines[0], lines[1:]
        if lines and lines[-1].lstrip().startswith("```"): lines = lines[:-1]
    limit = MAX_CHARS - 20
    group, size = [], 0
    for line in lines + [None]:
        if group and (line is None or size + len(line) > limit):
            text = "\n".join(group)
            yield f"{opener}\n{text}\n```" if fenced else text
            group, size = [], 0
        if line is not None:
            line = line[:limit]  # ponytail: a single line over the limit is hard-cut
            group.append(line); size += len(line) + 1


def pieces(body):
    """Pack blocks into <= MAX_CHARS pieces."""
    cur = ""
    for blk in blocks(body):
        if len(blk) > MAX_CHARS:
            if cur: yield cur; cur = ""
            yield from split_block(blk)
            continue
        if cur and len(cur) + len(blk) > MAX_CHARS:
            yield cur; cur = ""
        cur += ("\n\n" if cur else "") + blk
    if cur: yield cur


def chunks(path):
    text, url = clean(path.read_text(encoding="utf-8", errors="replace"))
    src, rel = source_of(path), path.relative_to(DATA).as_posix()
    pos = 0  # chunk index within the file; path is the document id (lets us fetch neighbour chunks)
    for heading, body in sections(text):
        for piece in pieces(body):
            if len(piece.strip()) < MIN_CHARS:
                continue
            yield {"source": src, "path": rel, "url": url, "heading": heading, "position": pos, "text": piece.strip()}
            pos += 1


def all_chunks(wanted=()):
    """Every chunk under data/, optionally limited to the given source names."""
    for f in sorted(DATA.rglob("*")):
        if f.suffix in EXT and f.is_file() and (not wanted or source_of(f) in wanted):
            yield from chunks(f)


def point_id(c):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{c['path']}|{c['heading']}|{c['text']}"))


def text_to_embed(c):
    return f"{c['heading']}\n{c['text']}"  # heading context helps both retrievers


if __name__ == "__main__":
    # fenced code with blank lines + '#' comments stays in one chunk and is not split into headings
    code = "```bash\n# a comment\nkubectl get pods\n\nkubectl get nodes\n```"
    doc = f"# Title\n\nIntro text that is long enough to keep around for the test, definitely over eighty characters.\n\n{code}\n"
    out = [p for _, body in sections(doc) for p in pieces(body)]
    assert len(list(sections(doc))) == 1 and any(code in p for p in out), out
    # oversized code is cut on lines and every piece is re-fenced
    big = "```yaml\n" + "\n".join(f"key{i}: value-{i}" * 3 for i in range(300)) + "\n```"
    parts = list(pieces(big))
    assert len(parts) > 1 and all(p.startswith("```yaml") and p.endswith("```") and len(p) <= MAX_CHARS for p in parts)
    print("chunking ok,", len(parts), "pieces from oversized block")
