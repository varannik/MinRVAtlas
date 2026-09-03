# CI/CD — AWS CodePipeline (no GitHub Actions)

Application builds and deploys run in **eu-west-2**. GitHub is the source repository only.

```text
Developer
    |
    | git push  (or: make pipeline-start)
    v
GitHub  4401/3DMinRV  (configured branch, default main)
    |
    | AWS CodeConnections  (minrv-ew2-github, eu-west-2)
    v
AWS CodePipeline V2  (queued executions)
    |
    +-- Source
    |
    +-- Build (parallel)
    |     |-- CodeBuild minrv-ew2-{stage}-build-web
    |     |     tests (tsc + eslint) → docker build → ECR minrv-ew2-web:<git-sha>
    |     `-- CodeBuild minrv-ew2-{stage}-build-sentinel
    |           tests (pytest) → docker build → ECR minrv-ew2-sentinel:<git-sha>
    |
    +-- Approve          (prod only, manual)
    |
    `-- Deploy
          ECS Fargate rolling update
          new task-definition revision
          image = repository:sha@sha256:digest
          circuit breaker + automatic rollback
```

There is **no** GitHub Actions workflow in this repository that builds images, pushes ECR, deploys ECS, updates CloudFormation, or invalidates CloudFront.

## 1. Architecture

| Piece | What it is |
| --- | --- |
| Source | GitHub via **CodeConnections** (not a PAT stored in CloudFormation) |
| Pipeline | `minrv-ew2-sandbox-pipeline` / `minrv-ew2-prod-pipeline` CloudFormation stacks at the CDK app (not inside the landing-zone Stage). Pipeline names: `minrv-ew2-{stage}-app`. CodePipeline **V2**, `QUEUED`. |
| Build | Two CodeBuild projects (web and Sentinel are independently deployable images) |
| Registry | Existing `minrv-ew2-web` and `minrv-ew2-sentinel` (immutable tags, scan on push, AES-256) |
| Runtime | Existing ECS **Fargate** cluster `minrv-ew2-{stage}-ecs` — services `web`, `api`, `worker`, `beat` |
| Edge | CloudFront (prod) is **not** invalidated by this pipeline |

Sandbox and prod share the two ECR repositories. They do **not** share ECS clusters, ALBs, or VPCs.

CodeBuild is **not** in the VPC, so local Docker layer cache is enabled. Image freshness comes from immutable SHA tags and new task-definition revisions, not from deleting Docker caches.

## 2. How a code change deploys

1. Push to the branch configured for that stage (`GITHUB_BRANCH` / `GITHUB_BRANCH_PROD`, default `main`).
2. CodePipeline starts. Prod waits for a **manual approval** after a successful build.
3. CodeBuild runs tests first. A failed test or failed `docker build` fails the pipeline; nothing is deployed.
4. The image tag is `CODEBUILD_RESOLVED_SOURCE_VERSION` (full Git SHA). `latest` is refused.
5. If that SHA tag already exists (immutable), build/push is skipped and the existing digest is reused.
6. CodePipeline ECS deploy registers a **new task-definition revision** with `imageUri` including `@sha256:…`, then rolling-updates the service.
7. ECS deployment circuit breaker is already on every service (`rollback: true`). Unhealthy rollouts revert to the last stable revision.

`force-new-deployment` against `latest` is not used.

## 3. Docker image versioning

```text
<account>.dkr.ecr.eu-west-2.amazonaws.com/minrv-ew2-web:<full-git-sha>
<account>.dkr.ecr.eu-west-2.amazonaws.com/minrv-ew2-sentinel:<full-git-sha>
```

Deploy metadata (`imagedefinitions-*.json`) uses tag **and** digest:

```text
IMAGE_URI=….amazonaws.com/minrv-ew2-web:<sha>@sha256:…
```

api, worker, and beat share the Sentinel image (same digest, three task families).

## 4. ECR lifecycle

Existing repositories are reused. Tags stay **immutable**. Scan-on-push and AES-256 encryption are unchanged (changing encryption would replace the repository).

Lifecycle (in-place policy update, not a replace):

* untagged images expire after 14 days
* at most 80 images retained

ECR does **not** know which tags ECS currently references. Do not drop the count so low that an active task definition’s tag is expired. Lifecycle never deletes “in use” with a hard guarantee — keep enough history, and roll back via **task-definition revision**, not by rebuilding.

## 5. ECS deployment

| Service | Container | Image | Notes |
| --- | --- | --- | --- |
| `minrv-ew2-{stage}-web` | `web` | `minrv-ew2-web` | public ALB :3000 |
| `minrv-ew2-{stage}-api` | `api` | `minrv-ew2-sentinel` | internal ALB :8000 |
| `minrv-ew2-{stage}-worker` | `worker` | `minrv-ew2-sentinel` | Celery worker |
| `minrv-ew2-{stage}-beat` | `beat` | `minrv-ew2-sentinel` | Celery beat |

CPU, memory, security groups, IAM roles, secrets, env, ports, health checks, and ALB target groups stay on the compute stack. The pipeline only changes the **image** on a new task-definition revision.

If `desiredCount` is still `0` (compute was never given `WEB_IMAGE_TAG` / `SENTINEL_IMAGE_TAG`), a pipeline deploy updates the task definition but starts **no tasks**. Scale by setting those tags on a compute deploy, or `aws ecs update-service --desired-count`.

### CDK drift

After a pipeline deploy, `cdk diff` on compute may show a different image than the last CloudFormation template (nginx placeholder or an older tag). The next **compute** stack update without `WEB_IMAGE_TAG` / `SENTINEL_IMAGE_TAG` matching the running SHA can revert images or set `desiredCount` back to 0. When changing compute infrastructure, pass the currently running Git SHA tags.

## 6. Rollback

Do **not** rebuild an old image.

```bash
# Previous task-definition revision for one service (default SERVICE=web)
APP=minrv-ew2-sandbox SERVICE=web make rollback

# Explicit revision
APP=minrv-ew2-prod SERVICE=api TASK_DEFINITION=minrv-ew2-prod-api:17 make rollback
```

ECS circuit breaker also rolls back automatically when a new deployment fails health checks.

## 7. Manual deploy paths

| Intent | Command | Deploys prod? |
| --- | --- | --- |
| Local image only | `make docker-build` | No |
| Push SHA tags to ECR from a laptop | `make docker-push` | No (does not update ECS) |
| Start the AWS pipeline | `make pipeline-start` | Sandbox yes; prod after console approval |
| CloudFormation landing zone | `make deploy` | Only with `APP=minrv-ew2-prod CONFIRM=YES` |

## 8. Logs

```bash
make pipeline-status
APP=minrv-ew2-sandbox SERVICE=web make logs
APP=minrv-ew2-sandbox SERVICE=codebuild-web make logs
APP=minrv-ew2-sandbox SERVICE=api SINCE=2h make logs
```

Log groups:

* `/minrv/ew2/{stage}/web|api|worker|beat`
* `/minrv/ew2/{stage}/codebuild-web`
* `/minrv/ew2/{stage}/codebuild-sentinel`

CodeBuild prints commit SHA, image URI, digest, ECR repository, ECS cluster, and stage. It must never print secrets, tokens, or access keys.

## 9. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Pipeline never starts on push | Connection `minrv-ew2-github` still **PENDING** — complete it in eu-west-2 Developer Tools → Connections. A connection in **eu-west-3** cannot drive this pipeline. |
| Source action fails | GitHub App not authorized for `4401/3DMinRV`, or wrong branch (`GITHUB_BRANCH`). |
| Build fails on tests | Web: `tsc` / `eslint`. Sentinel: `pytest` under `ENVIRONMENT=test`. Fix code; do not skip. |
| `Image tag already exists` then skip | Expected for immutable tags when sandbox and prod build the same SHA. |
| Deploy succeeds, 0 running tasks | `desiredCount` is 0 — see §5. |
| Deploy fails then old tasks return | Circuit breaker rollback — inspect `make ecs-status` events and `/minrv/ew2/{stage}/…` logs. |
| `cdk deploy` compute after pipeline | Pass matching `WEB_IMAGE_TAG` / `SENTINEL_IMAGE_TAG` (§5 drift). |
| CloudFront still shows old HTML | Default cache is disabled; `/_next/static/*` is hashed. Do not invalidate `/*` on Sentinel deploys. HTML issues are almost never a backend image problem. |

## 10. Makefile commands

From the repo root (delegates to `infra/`):

```bash
make ci                 # local lint/typecheck/pytest (no deploy)
make docker-build       # linux/amd64 images tagged with Git SHA + :local
make docker-push        # build + push SHA tags to ECR (no ECS update)
make pipeline           # pipeline status + console URL
make pipeline-start     # start CodePipeline execution
make pipeline-status    # stage/action statuses
make ecs-status         # desired/running/pending, task defs, deployments
make logs               # CloudWatch tail (SERVICE=web|api|worker|beat|codebuild-web|…)
make rollback           # previous (or TASK_DEFINITION=) ECS task-definition revision
make deploy             # CDK landing zone only (not an application release)
```

Useful variables: `APP` (`minrv-ew2-sandbox` \| `minrv-ew2-prod`), `AWS_PROFILE`, `AWS_REGION`, `IMAGE_TAG`, `SERVICE`, `TASK_DEFINITION`, `SINCE`, `GITHUB_CONNECTION_ARN`.

`make deploy` / `make pipeline-start` call `aws sts get-caller-identity` and refuse the wrong account.

## CloudFront

Prod CloudFront caches HTML with caching disabled and hashes `/_next/static/*`. This pipeline does **not** create an invalidation. Do not add `/*` invalidations on API/worker deploys.

## Monorepo / selective builds

v1 always builds **both** images on every commit so imagedefinitions stay consistent for the four ECS services. Path-filtered pipelines (web-only vs Sentinel-only) are the right follow-up if build time becomes the bottleneck — do not merge both apps into one Docker image.

## IAM notes

* CodeBuild: pull/push on the two ECR repos, logs, artifact bucket. `ecr:GetAuthorizationToken` is account-level (`Resource: *`) because the API requires it.
* CodePipeline ECS deploy (CDK `EcsDeployAction`): AWS’s action grants `ecs:*` and `iam:PassRole` with `Resource: *` plus `iam:PassedToService`. Tightening that requires replacing the native ECS deploy action.
* GitHub OIDC role `minrv-ew2-{stage}-github-deploy` remains on the security stack for optional Actions; it is **not** used by this pipeline. Do not delete it in a security-stack change unless you intend that churn.
* No AWS access keys in GitHub, Makefile, buildspec, or Dockerfiles.

## Operator: first pipeline deploy

These commands change AWS. They are **not** run by the CI/CD code change itself.

```bash
# 1. Identity
aws sts get-caller-identity   # must be 625239230739

# 2. Synth / validate (no deploy)
cd infra && npx cdk synth minrv-ew2-ecr 'minrv-ew2-sandbox/*'

# 3. Landing zone + pipeline stacks (sandbox)
cd /path/to/3DMinRV && make deploy

# 4. Complete GitHub connection in the eu-west-2 console (PENDING → AVAILABLE)

# 5. Prod pipeline (additive stack; CONFIRM required)
CONFIRM=YES APP=minrv-ew2-prod make deploy

# 6. Release
git push
# or
make pipeline-start
APP=minrv-ew2-prod make pipeline-start   # still needs console approval
```
