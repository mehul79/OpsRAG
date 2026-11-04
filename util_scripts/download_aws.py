"""Download AWS docs as markdown via each guide's llms.txt index.

Usage: python scripts/download_aws.py [service ...]   (default: all)
Output: data/aws/<service>/<page>.md, first line = source URL comment.
Re-runs skip files that already exist.
"""
import re, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://docs.aws.amazon.com/"
OUT = Path(__file__).resolve().parent.parent / "data" / "aws"
UA = "OpsRAG-portfolio-project/0.1 (personal RAG corpus; polite crawl)"

# service -> guide paths
GUIDES = {
    "ec2": ["AWSEC2/latest/UserGuide"],
    "ecs": ["AmazonECS/latest/developerguide"],
    "eks": ["eks/latest/userguide"],
    "iam": ["IAM/latest/UserGuide"],
    "cloudfront": ["AmazonCloudFront/latest/DeveloperGuide"],
    "rds": ["AmazonRDS/latest/UserGuide"],
    "billing": ["awsaccountbilling/latest/aboutv2"],
    "support": ["awssupport/latest/user"],
    "elb": ["elasticloadbalancing/latest/application", "elasticloadbalancing/latest/network",
            "elasticloadbalancing/latest/gateway", "elasticloadbalancing/latest/classic"],
}

# RDS is ~1,400 pages; keep only operational sections, drop engine-specific/API/niche ones.
RDS_KEEP = {
    "What is Amazon RDS?", "Getting started", "Configuring a DB instance", "Managing a DB instance",
    "Configuring and managing a Multi-AZ deployment", "Using Blue/Green Deployments for database updates",
    "Backing up, restoring, and exporting data", "Monitoring metrics in a DB instance",
    "Monitoring events, logs, and database activity streams", "Amazon RDS Proxy", "Security",
}
SKIP_URL = re.compile(r"DocumentHistory|document-history|doc-history|release-notes|/full\.md$", re.I)  # full.md = whole guide concatenated


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                return r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    return None


def page_urls(index, guide, service):
    """Yield .md URLs from llms.txt, honouring the RDS section filter."""
    section, seen = None, set()
    for line in index.splitlines():
        m = re.match(r"^## (?:\[(.+?)\]\(.*?\)|(.+))$", line)
        if m:
            section = m.group(1) or m.group(2)
            continue
        if service == "rds" and section not in RDS_KEEP:
            continue
        for u in re.findall(r"\((https://docs\.aws\.amazon\.com/[^)\s]+\.md)\)", line):
            if u not in seen and not SKIP_URL.search(u):
                seen.add(u)
                yield u


def fetch(job):
    url, dest = job
    if dest.exists():
        return 0
    body = get(url)
    time.sleep(0.15)
    if not body:
        print("FAIL", url)
        return 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(f"<!-- source: {url} -->\n{body}", encoding="utf-8")
    return 1


def main():
    services = sys.argv[1:] or list(GUIDES)
    for svc in services:
        jobs = []
        for guide in GUIDES[svc]:
            index = get(f"{BASE}{guide}/llms.txt")
            if index is None:
                print(f"no llms.txt for {guide}, skipping")
                continue
            tag = guide.split("/")[-1] if svc == "elb" else ""
            for u in page_urls(index, guide, svc):
                name = u.removeprefix(BASE).removeprefix(guide + "/").replace("/", "_")
                jobs.append((u, OUT / svc / tag / name))
        with ThreadPoolExecutor(4) as ex:
            n = sum(ex.map(fetch, jobs))
        print(f"{svc}: {len(jobs)} pages listed, {n} downloaded")


if __name__ == "__main__":
    main()
