"""Copy only the useful doc files from the raw git clones into data/_clean/.

Raw clones (data/k8s, docker, tf-core, tf-aws) are left untouched; review _clean, then swap.
Output: _clean/k8s, _clean/docker, _clean/terraform/core, _clean/terraform/aws
"""
import re, shutil
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
OUT = DATA / "_clean"
EXT = {".md", ".mdx", ".markdown"}
NOISE = re.compile(r"release-notes|previous-versions|vpclattice|version-\d+-upgrade")  # changelogs, old versions, off-scope
MIN_BODY = 200  # drop near-empty section index pages


def body(text):
    return re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S).strip()


def generated(text):
    m = re.match(r"\A---\n(.*?)\n---\n", text, flags=re.S)
    return bool(m and re.search(r"^auto_generated:\s*true", m.group(1), flags=re.M))


def copy(src_root, dest_root, keep, drop_generated=False):
    n = skipped = 0
    for f in src_root.rglob("*"):
        if f.suffix not in EXT or not f.is_file():
            continue
        rel = f.relative_to(src_root)
        if not keep(rel) or NOISE.search(rel.as_posix()):
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        if (drop_generated and generated(text)) or len(body(text)) < MIN_BODY:
            skipped += 1
            continue
        dest = dest_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, dest)
        n += 1
    print(f"{dest_root.relative_to(OUT)}: kept {n}, dropped {skipped} generated/near-empty")


def under(*prefixes):
    return lambda rel: any(rel.parts[:len(p.split("/"))] == tuple(p.split("/")) for p in prefixes)


# --- Kubernetes
copy(DATA / "k8s/content/en/docs", OUT / "k8s",
     under("concepts", "tasks", "tutorials", "setup",
           "reference/glossary", "reference/access-authn-authz", "reference/networking",
           "reference/node", "reference/scheduling", "reference/using-api",
           "reference/labels-annotations-taints", "reference/debug-cluster", "reference/issues-security"),
     drop_generated=True)

# --- Docker (drop includes, generated api/samples/cli refs, billing/admin, AI/agentic/dhi/extensions)
copy(DATA / "docker/content", OUT / "docker",
     under("get-started", "guides", "reference/compose-file",
           "manuals/engine", "manuals/build", "manuals/compose", "manuals/desktop",
           "manuals/docker-hub", "manuals/security", "manuals/scout", "manuals/faqs"))

# --- Terraform core (language, cli, intro, internals; no partials)
copy(DATA / "tf-core/content/terraform/v1.17.x/docs", OUT / "terraform/core",
     under("language", "cli", "intro", "internals"))

# --- Terraform AWS provider: resource pages for the services we have AWS docs for + guides
AWS_PREFIX = re.compile(
    r"^(iam_|instance|ami|ebs_|ec2_|launch_template|autoscaling_|vpc|subnet|security_group|route_table|route\.|"
    r"internet_gateway|nat_gateway|eip|network_|ecs_|eks_|db_|rds_|cloudfront_|lb|alb|elb|"
    r"s3_|lambda_|cloudwatch_|route53_|kms_|secretsmanager_|ecr_)")
copy(DATA / "tf-aws/website/docs", OUT / "terraform/aws",
     lambda rel: rel.parts[0] == "guides" or (rel.parts[0] == "r" and AWS_PREFIX.match(rel.name)))
