# 3DMinRV + Data Sentinel — AWS system design (eu-west-2)

Status: **infrastructure design**. Application code is unchanged. This deploys the integrated platform described in [data-sentinel-isometric-integration.md](./data-sentinel-isometric-integration.md).

| | Value |
| --- | --- |
| Account | `625239230739` (existing 44.01 account) |
| Region | **`eu-west-2` (London)** |
| IaC | **AWS CDK** (synthesizes CloudFormation) |
| Bootstrap | **`CDKToolkit` in `eu-west-2`** (and `us-east-1` only if CloudFront is enabled) |
| App | **New stack family in London** — do not extend Ireland |
| Emulation | **None.** Every resource is created in real AWS. No LocalStack, no Compose-as-AWS, no “local” CloudFormation environment. |

Ireland already has `minrv-dev-*`, `minrv-v4-*`, and `datasentinel-dev-*` in **`eu-west-1`**. Those stacks stay where they are. They cannot create VPCs, ECS, or Aurora in London. `minrv-dev-local-deploy` in Ireland is unrelated to this design.

---

## 1. What is being deployed

This is not an empty landing zone and not a LocalStack rehearsal. CDK deploys the **in-house 44.01 dMRV platform**:

| Layer | Runs as | Role (from the integration plan) |
| --- | --- | --- |
| **3DMinRV** | ECS Fargate `dmrv-web` (Next.js) | Operator surface and orchestrator. Tenant isolation. Isometric M2M. Step-3 registry rules. Gate: ready to submit. |
| **Data Sentinel** | ECS Fargate `sentinel-api` + `sentinel-worker` + `sentinel-beat` | Quality engine. Step-1 DQA, Step-2 HU/ST/ML anomaly, Step-4 document V&V. HTTP sidecar — not in-process Python, not the Vite UI. |
| **Isometric** | External SaaS | Requirement catalogue and later Certify write-back. Tokens only on the Next task. |

Pipeline on AWS (screenshot order, runtime gating):

```
Operator upload (data CSV/parquet + docs PDF/Word/Excel/images)
        │
        ├──────────────────────────────┐
        ▼                              ▼
  S3 evidence (KMS)              S3 evidence (KMS)
        │                              │
  Step-1 DQA (FastAPI/worker)    Step-4 V&V (FastAPI/worker)
        ▼
  Step-2 Anomaly (HU / ST / ML)
        ▼
  Qualified + cleaned data
        ▼
  Step-3 registry rules (Next adapter, Isometric in-situ mineralisation)
        │
        ├─ pass → (later) submit to Certify
        └─ fail → correct data or documents
```

Do **not** deploy:

- A Data Sentinel UI (Vite was removed; operators use `dmrv-web` `/quality`)
- A separate us-east-1 public API / static S3 UI for Sentinel
- The stub `IsometricConnector` (`/v1/verifications`)
- Ireland `minrv-dev-*` / `datasentinel-dev-*` into London by stack import

---

## 2. Deploy path (real AWS only)

Two CloudFormation stacks you care about in London:

| Stack | Region | Who creates it | Purpose |
| --- | --- | --- | --- |
| **`CDKToolkit`** | `eu-west-2` | `cdk bootstrap` | Asset bucket, file/image publish roles, bootstrap version. **Not** the app. |
| **`minrv-ew2-sandbox`** (then later `minrv-ew2-prod`) | `eu-west-2` | `cdk deploy` | The platform: VPC, data, ECS, ALBs, secrets. **New** stack. |

If CloudFront is in scope, also:

| Stack | Region | Who creates it |
| --- | --- | --- |
| **`CDKToolkit`** | `us-east-1` | `cdk bootstrap aws://625239230739/us-east-1` |
| Edge resources (ACM, WAF CLOUDFRONT, Distribution) | `us-east-1` | CDK stack with `env.region = us-east-1` |

### 2.1 Bootstrap (once per region)

```bash
export AWS_REGION=eu-west-2
export CDK_DEFAULT_ACCOUNT=625239230739
export CDK_DEFAULT_REGION=eu-west-2

npx cdk bootstrap aws://625239230739/eu-west-2
# only if using CloudFront:
npx cdk bootstrap aws://625239230739/us-east-1
```

That yields:

`arn:aws:cloudformation:eu-west-2:625239230739:stack/CDKToolkit/...`

A `CDKToolkit` already in `eu-west-1` does **not** bootstrap London. Do not point the Ireland bootstrap bucket at this app.

### 2.2 App stack (every deploy)

CDK app `env`:

```ts
env: {
  account: "625239230739",
  region: "eu-west-2",
}
```

```bash
npx cdk deploy minrv-ew2-sandbox
# prod:
CONFIRM=YES npx cdk deploy minrv-ew2-prod
```

Synthesized template is real CloudFormation in `eu-west-2`. Images go to **ECR in `eu-west-2`** via the bootstrap image-publishing role (or an app-owned ECR repo the compute stack creates).

### 2.3 Makefile (only real AWS)

```makefile
ACCOUNT    ?= 625239230739
REGION     ?= eu-west-2
APP        ?= minrv-ew2-sandbox

.PHONY: bootstrap deploy diff destroy synth

bootstrap:
	npx cdk bootstrap aws://$(ACCOUNT)/$(REGION)

synth:
	npx cdk synth $(APP)

diff:
	npx cdk diff $(APP)

deploy:
	npx cdk deploy $(APP) --require-approval broadening

destroy:
	npx cdk destroy $(APP)
```

No `local-up`, no `cfn-local`, no `AWS_ENDPOINT_URL`, no LocalStack keys.

---

## 3. Topology (eu-west-2)

```
                         ┌─────────────────────────────────────────┐
                         │ us-east-1 (edge only, if CloudFront)    │
                         │ ACM  ·  CloudFront  ·  WAF (CLOUDFRONT) │
                         └──────────────────┬──────────────────────┘
                                            │ HTTPS
                         ┌──────────────────▼──────────────────────┐
                         │ eu-west-2  VPC  10.44.0.0/16            │
                         │ AZs: eu-west-2a / 2b / 2c               │
                         │                                          │
  operators / Entra ──►  │  Public subnets                          │
                         │    NAT  ·  public ALB (Next.js only)     │
                         │            │                             │
                         │  Private subnets                         │
                         │    ECS dmrv-web :3000                    │
                         │    ECS sentinel-api :8000                │
                         │    ECS sentinel-worker                   │
                         │    ECS sentinel-beat (desiredCount = 1)  │
                         │    Internal ALB → sentinel-api only      │
                         │            │                             │
                         │  Isolated subnets (no NAT)               │
                         │    Aurora PostgreSQL Serverless v2       │
                         │    RDS Proxy                             │
                         │    ElastiCache Serverless (Valkey)       │
                         │                                          │
                         │  VPC endpoints: S3, ECR, Logs, Secrets,  │
                         │    KMS, STS, ECS, Bedrock Runtime        │
                         └──────────────┬───────────────────────────┘
                                        │ NAT :443
                          api.isometric.com / api.sandbox.isometric.com
                          login.microsoftonline.com (SSO)
```

Hard rules (must appear in CDK):

1. Internet → (CloudFront →) public ALB → **`dmrv-web` only**.
2. `dmrv-web` → internal ALB → **`sentinel-api :8000`**. Browser never reaches FastAPI.
3. Sentinel api/worker/beat → RDS Proxy :5432 and Valkey :6379 (TLS).
4. Aurora and Valkey: **no** public-subnet ingress.
5. No `0.0.0.0/0` on 8000, 5432, or 6379.
6. Isometric HTTPS only from **`dmrv-web`**. Sentinel task role **cannot** read `IsometricSecret`.

---

## 4. CDK app layout

One CDK app, **new** stack names so they never collide with Ireland `minrv-dev-*`.

```
infra/                          # CDK (you create this)
  bin/app.ts
  lib/
    stage.ts                    # SandboxStage / ProdStage
    network-stack.ts
    security-stack.ts
    data-stack.ts
    edge-stack.ts               # ALBs + optional us-east-1 CloudFront stack
    compute-stack.ts            # ECS: web, api, worker, beat
    observability-stack.ts
    compliance-stack.ts
  cdk.json
```

`bin/app.ts` sketch:

```ts
const envEw2 = { account: "625239230739", region: "eu-west-2" };

new MinrvStage(app, "minrv-ew2-sandbox", {
  env: envEw2,
  stageName: "sandbox",
  isometricApi: "sandbox",      // api.sandbox.isometric.com
  natGateways: 1,
  auroraMinAcu: 0.5,            # real cluster; do not omit data plane
  webCount: 1,
  apiCount: 1,
  workerCount: 1,
});

new MinrvStage(app, "minrv-ew2-prod", {
  env: envEw2,
  stageName: "prod",
  isometricApi: "production",
  natGateways: 3,
  auroraMinAcu: 0.5,
  webCount: 2,
  apiCount: 2,
  workerCount: 2,
});
```

Using a CDK **Stage** still creates several CloudFormation stacks in `eu-west-2` (network, data, compute, …). That is normal CDK. They are the **new London family**, not clones of `minrv-dev-network` in Ireland.

If you want a single CloudFormation parent instead, wrap the same constructs as `NestedStack`s under one `minrv-ew2-sandbox` stack. Functionally the same resources.

---

## 5. Resources the app stack must create

All of these are real AWS resources in `eu-west-2` (plus optional edge in `us-east-1`).

### 5.1 Network

| Construct | Notes |
| --- | --- |
| VPC `10.44.0.0/16` | DNS hostnames on |
| 3 public / 3 private / 3 isolated `/24` | `eu-west-2a/b/c` |
| IGW, NAT (1 sandbox, 3 prod), EIP | Isolated route tables: **no** `0.0.0.0/0` |
| Gateway endpoint S3 | |
| Interface endpoints | ECR api+dkr, Logs, Secrets, KMS, STS, ECS, Bedrock Runtime |
| VPC flow logs | CloudWatch, prod required |
| Security groups | See §3 |

### 5.2 Security and secrets

| Construct | Notes |
| --- | --- |
| KMS CMK `alias/minrv-ew2-${stage}` | S3, secrets, Aurora, logs. Rotation on |
| Secret `minrv/ew2/${stage}/app` | Sentinel JWT, DB URL or IAM user, Valkey URL, `SENTINEL_SERVICE_TOKEN`, `ALLOWED_ORIGINS` |
| Secret `minrv/ew2/${stage}/isometric` | `ISOMETRIC_CLIENT_SECRET`, `ISOMETRIC_ACCESS_TOKEN`, `ISOMETRIC_PROJECT_ID` — **web task only** |
| Optional Entra secret | SSO |
| RDS secret rotation | once Aurora exists |

Sandbox uses **Isometric sandbox** tokens. Prod uses production. Never copy Ireland secrets into London.

### 5.3 Data (always created — this is the platform)

| Construct | Notes |
| --- | --- |
| Evidence bucket | `minrv-ew2-${stage}-evidence-${AccountId}` — versioning, SSE-KMS, Block Public Access, TLS deny, lifecycle. Object Lock Governance in prod. Holds **data files and docs** (integration: CSV/parquet → DQA; PDF/docx → V&V; xlsx → both). |
| Logs bucket | ALB / CloudFront access logs |
| Aurora PostgreSQL 16 Serverless v2 | Encrypted, IAM DB auth, log exports, deletion protection in prod, backup 7d sandbox / 35d prod |
| RDS Proxy | TLS, IAM auth, Celery-friendly idle timeout |
| ElastiCache Serverless Valkey | TLS. Celery broker for DQA/anomaly/V&V jobs |

Injection time series remain **operator-upload-first** (integration §4.2): objects in the evidence bucket, not an undocumented Isometric time-series GET.

Isometric source bytes pulled by Next (when `url_info` allows) are written to this same bucket, then classified by MIME onto DQA vs V&V.

### 5.4 Edge

| Construct | Region | Notes |
| --- | --- | --- |
| Public ALB | eu-west-2 | HTTPS, target `dmrv-web:3000` |
| Internal ALB | eu-west-2 | Target `sentinel-api:8000`, health `GET /api/health` |
| ACM for ALB | eu-west-2 | App domain |
| Regional WAF | eu-west-2 | On public ALB |
| CloudFront + ACM + WAF | us-east-1 | Optional but recommended; origin = public ALB; cache off for `/api/*`; cache on `/_next/static/*` |

### 5.5 Compute (maps 1:1 to the integration sidecar)

| Service | CPU / mem (prod) | Count | LB | Image / command |
| --- | --- | --- | --- | --- |
| `dmrv-web` | 1 vCPU / 2 GB | 1 sandbox / 2 prod | public | Next standalone. Secrets: Isometric + Sentinel token. Env: `SENTINEL_BASE_URL=https://<internal-alb>` |
| `sentinel-api` | 1 vCPU / 2 GB | 1 / 2 | internal | `uvicorn app.main:app --host 0.0.0.0 --port 8000` (**no --reload**) |
| `sentinel-worker` | 1 vCPU / 2 GB | 1 / 2 | none | Celery worker (DQA, anomaly, V&V jobs) |
| `sentinel-beat` | 0.25 vCPU / 0.5 GB | **1** | none | Celery beat. Do not autoscale |

Cluster: Container Insights enhanced. No Fargate Spot on web/api in prod.

Web task env also needs `x-tenant-id` mapping `fourfourone` → one Sentinel project id (integration Phase 1).

Sentinel: `LLM_PROVIDER=bedrock`, `BEDROCK_INFERENCE_PROFILE=eu.anthropic.claude-sonnet-4-5-20250929-v1:0` (or current EU profile). **No** `ANTHROPIC_API_KEY` in prod.

ECR: two repos `minrv-ew2-web`, `minrv-ew2-sentinel`. Scan on push, tag immutability, images by **digest**.

### 5.6 Observability and compliance

| Construct | Notes |
| --- | --- |
| Log groups `/minrv/ew2/${stage}/{web,api,worker,beat,alb}` | 30d sandbox / 365d prod |
| Alarms | ALB 5xx, unhealthy hosts, Aurora, Valkey, ECS CPU |
| SNS ops topic | |
| CloudTrail data events | evidence bucket, prod |
| GuardDuty, Security Hub, Access Analyzer, Config | sandbox+prod |

---

## 6. IAM

Least privilege. CDK bootstrap roles (`cdk-hnb659fds-*`) stay on the **CDKToolkit** stack. App roles are separate.

### 6.1 Deploy

Laptop or GitHub OIDC assumes a deploy role that may:

- `cloudformation:*` on `arn:aws:cloudformation:eu-west-2:625239230739:stack/minrv-ew2-*` and `CDKToolkit`
- `iam:PassRole` to CDK bootstrap roles and app ECS roles
- ECR push to `minrv-ew2-*`
- S3 on the bootstrap asset bucket in **eu-west-2**

Trust GitHub OIDC `repo:varannik/MinRVAtlas:environment:sandbox` / `:prod`. No long-lived access keys.

### 6.2 ECS task execution

Pulls images, injects secrets: ECR, `secretsmanager:GetSecretValue` on `minrv/ew2/${stage}/*`, `kms:Decrypt` on the app CMK, `logs:PutLogEvents`.

### 6.3 Web task (Isometric M2M)

- Read `minrv/ew2/${stage}/isometric` and the Sentinel service token
- **Deny** `bedrock:InvokeModel`
- **Deny** evidence-bucket writes (uploads go Next → Sentinel → S3)
- Outbound HTTPS to Isometric; no AWS IAM for Certify

### 6.4 Sentinel task (DQA / anomaly / V&V)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Evidence",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::minrv-ew2-${stage}-evidence-${AccountId}",
        "arn:aws:s3:::minrv-ew2-${stage}-evidence-${AccountId}/*"
      ]
    },
    {
      "Sid": "BedrockEu",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:eu-west-2:${AccountId}:inference-profile/eu.anthropic.*",
        "arn:aws:bedrock:*::foundation-model/anthropic.*"
      ]
    },
    {
      "Sid": "RdsIam",
      "Effect": "Allow",
      "Action": ["rds-db:connect"],
      "Resource": "arn:aws:rds-db:eu-west-2:${AccountId}:dbuser:${DbResourceId}/dmrv_app"
    },
    {
      "Sid": "AppSecretOnly",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:eu-west-2:${AccountId}:secret:minrv/ew2/${stage}/app*"
    },
    {
      "Sid": "DenyIsometricSecret",
      "Effect": "Deny",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:eu-west-2:${AccountId}:secret:minrv/ew2/${stage}/isometric*"
    }
  ]
}
```

---

## 7. How AWS maps to the integration contract

| Integration concern | AWS placement |
| --- | --- |
| Payload `data` (sensor-stream, datasets, injection CSV) | Evidence S3 → `sentinel-api` / worker DQA + anomaly |
| Payload `document` (PDD, integrity reports, permits) | Evidence S3 → V&V engine (`/api/v2/vv`) |
| Payload `both` (xlsx, monitoring `source_id` file) | Same object; both engines; board item complete only if both pass |
| Live monitoring requirements | `dmrv-web` → Certify `GET .../monitoring_requirements` (existing adapter) |
| Datapoints / source metadata / private URL | `dmrv-web` (Phase 4); bytes stored in evidence S3 |
| Published PDD / VVB reports | `dmrv-web` → Registry `GET .../documents` |
| PDD checklist (no public API) | Bundled rulebook on Next, not a fetch |
| Time-series GET from Isometric | Not available — operator upload to S3 |
| Step-3 methodology math | **Next** adapter (in-situ mineralisation). Sentinel checkpoints stay document-side |
| Certify write-back (Phase 6) | **Next only**, after DQA/AD/V&V/Step-3 green |
| Quality run ids | Aurora via Sentinel |
| `fourfourone` / Fujairah | Single tenant in this stage |

Gating: DQA hard-gate fail or critical anomaly or critical V&V or Step-3 fail → no Certify push.

---

## 8. Environments vs Isometric

| CDK stage | AWS | Isometric host | Data |
| --- | --- | --- | --- |
| `minrv-ew2-sandbox` | Real `eu-west-2` | `https://api.sandbox.isometric.com` | Fujairah sandbox project + test uploads |
| `minrv-ew2-prod` | Real `eu-west-2` | `https://api.isometric.com` | 44.01 production MRV |

Both are real AWS. Prefer a second AWS account for prod later; until then separate KMS, secrets, VPCs, and IAM so sandbox roles cannot read prod Isometric tokens.

---

## 9. Containers

| Image | Build |
| --- | --- |
| `minrv-ew2-web` | Node 22, Next `output: 'standalone'`, non-root |
| `minrv-ew2-sentinel` | Existing backend Dockerfile, one image, three commands (api/worker/beat), non-root, no `--reload` |

Task image URIs use `@sha256:…` in `eu-west-2` ECR.

---

## 10. Implementation order (AWS, not a local rehearsal)

1. `cdk bootstrap aws://625239230739/eu-west-2` → **`CDKToolkit`**.
2. CDK app + `cdk deploy minrv-ew2-sandbox` → **new** network, KMS, secrets, S3, Aurora, Valkey, ALBs, ECS (all four services), logging.
3. Put **Isometric sandbox** credentials in `minrv/ew2/sandbox/isometric`.
4. Smoke: Next `GET /api/registry/requirements?projectId=fujairah-mineral`; Sentinel `GET /api/health`; DQA upload; V&V document upload.
5. Optional: bootstrap + deploy CloudFront in `us-east-1`.
6. `cdk deploy minrv-ew2-prod` with `CONFIRM=YES` and production Isometric tokens.

Do not expose 8000 on the public ALB. Do not import Ireland stack exports into these stacks.

---

## 11. Explicit non-goals

- LocalStack, `awslocal`, or a CloudFormation `Environment=local`
- Docker Compose standing in for Aurora/Valkey/ECS
- Reusing `arn:aws:cloudformation:eu-west-1:625239230739:stack/minrv-dev-local-deploy/...`
- EKS, Amplify Hosting, Lambda for DQA
- Shipping a Sentinel UI (operators use `dmrv-web` `/quality`)
- Extending `datasentinel-dev-*` (public API shape) into this VPC

---

## 12. Checklist before `minrv-ew2-prod`

- [ ] `CDKToolkit` exists in **eu-west-2** (and us-east-1 if CloudFront)
- [ ] `cdk diff minrv-ew2-sandbox` reviewed; stack names are `minrv-ew2-*` not `minrv-dev-*`
- [ ] Internal ALB not reachable from the internet
- [ ] Sentinel task denied on Isometric secret; web task cannot InvokeModel
- [ ] Evidence bucket: public access block, TLS deny, KMS, versioning
- [ ] DQA (data) and V&V (docs) both write/read that bucket
- [ ] Next requirements fetch works against Isometric **sandbox**
- [ ] Aurora backup restore drill
- [ ] Isometric token expiry reminder (12 months)
- [ ] Prod deploy requires explicit confirmation
