"""Writes evals/dataset.jsonl and checks every expected-path regex matches at least one corpus file."""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
files = [p.relative_to(ROOT / "data").as_posix() for p in (ROOT / "data").rglob("*") if p.is_file()]

# (kind, question, regex over the chunk's path under data/; None = not answerable from the docs)
Q = [
 ("exact", "What does CrashLoopBackOff mean and how do I debug it?", r"k8s/(tasks/debug/debug-application/debug-pods|concepts/workloads/pods/pod-lifecycle)"),
 ("howto", "How do I configure a liveness probe on a container?", r"k8s/tasks/configure-pod-container/configure-liveness-readiness-startup-probes"),
 ("compare", "What is the difference between a Deployment and a StatefulSet?", r"k8s/concepts/workloads/controllers/(deployment|statefulset)"),
 ("howto", "How do I create a Kubernetes Secret?", r"k8s/(concepts/configuration/secret|tasks/configmap-secret/managing-secret)"),
 ("concept", "How does a Kubernetes Service route traffic to pods?", r"k8s/concepts/services-networking/service"),
 ("howto", "How do I set CPU and memory requests and limits for a container?", r"k8s/(concepts/configuration/manage-resources-containers|tasks/configure-pod-container/assign-(cpu|memory)-resource)"),
 ("concept", "What is a PersistentVolumeClaim?", r"k8s/concepts/storage/persistent-volumes"),
 ("howto", "How do I roll back a Deployment after a bad rollout?", r"k8s/concepts/workloads/controllers/deployment"),
 ("concept", "How do taints and tolerations work?", r"k8s/concepts/scheduling-eviction/taint-and-toleration"),
 ("exact", "Pod stuck in ImagePullBackOff, why?", r"k8s/(concepts/containers/images|tasks/debug/debug-application/debug-pods)"),
 ("howto", "How do I write a multi-stage Dockerfile?", r"docker/(manuals/build/building/multi-stage|guides/.*)"),
 ("howto", "How do I persist data with Docker volumes?", r"docker/manuals/engine/storage/volumes"),
 ("concept", "What does depends_on do in Docker Compose?", r"docker/(reference/compose-file/services|manuals/compose/how-tos/startup-order)"),
 ("howto", "How do I limit the memory and CPU a Docker container can use?", r"docker/manuals/engine/containers/resource_constraints"),
 ("concept", "How does Docker bridge networking work?", r"docker/manuals/engine/network/drivers/bridge"),
 ("concept", "How does the Docker build cache work?", r"docker/manuals/build/cache"),
 ("howto", "How do I use for_each in Terraform?", r"terraform/core/language/meta-arguments/for_each"),
 ("concept", "What is Terraform state and why does it matter?", r"terraform/core/language/state"),
 ("howto", "How do I store Terraform state remotely in S3?", r"terraform/core/language/(backend/s3|state/remote|backend)"),
 ("concept", "How do Terraform modules work?", r"terraform/core/language/modules"),
 ("concept", "What does terraform plan do?", r"terraform/core/cli/commands/plan"),
 ("exact", "aws_iam_role_policy_attachment", r"terraform/aws/r/iam_role_policy_attachment"),
 ("howto", "How do I attach a managed policy to an IAM role in Terraform?", r"terraform/aws/r/iam_role_policy_attachment"),
 ("exact", "aws_s3_bucket_versioning", r"terraform/aws/r/s3_bucket_versioning"),
 ("howto", "How do I create an EKS cluster with Terraform?", r"(terraform/aws/r/eks_cluster|aws/eks/.*(terraform|-tf))"),
 ("exact", "aws_lb_listener_rule", r"terraform/aws/r/lb_listener_rule"),
 ("concept", "How do EC2 security groups work?", r"aws/ec2/.*security-group"),
 ("compare", "What is the difference between an ECS task role and the task execution role?", r"aws/ecs/.*(task-iam-role|task_execution)"),
 ("howto", "How do I give pods in EKS access to AWS services using IAM roles?", r"aws/eks/.*(iam-roles-for-service-accounts|pod-identities)"),
 ("howto", "How do I invalidate cached files in CloudFront?", r"aws/cloudfront/.*[Ii]nvalidation"),
 ("concept", "How does RDS Multi-AZ failover work?", r"aws/rds/.*[Mm]ulti-?AZ"),
 ("compare", "What is the difference between an Application Load Balancer and a Network Load Balancer?", r"aws/elb/"),
 ("concept", "How does IAM policy evaluation logic decide allow or deny?", r"aws/iam/.*evaluation-logic"),
 ("vague", "my pod keeps restarting after deploy", r"k8s/(concepts/workloads/pods/pod-lifecycle|tasks/debug/debug-application)"),
 ("vague", "terraform apply says the state is locked", r"terraform/core/(language/state/locking|cli/commands/force-unlock)"),
 ("none", "How do I make pizza dough?", None),
 ("none", "What is the weather in Mumbai today?", None),
]
bad = [(q, rx) for _, q, rx in Q if rx and not any(re.search(rx, f) for f in files)]
for q, rx in bad: print("NO FILE MATCHES:", q, "|", rx)
if not bad:
    (ROOT / "evals" / "dataset.jsonl").write_text(
        "".join(json.dumps({"kind": k, "question": q, "expect": rx}) + "\n" for k, q, rx in Q), encoding="utf-8")
    print("wrote", len(Q), "questions;", sum(rx is None for _, _, rx in Q), "unanswerable")
