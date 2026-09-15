# 3DMinRV + Data Sentinel — AWS CDK (eu-west-2)

Infrastructure for account `625239230739`, region **eu-west-2**. Application code is unchanged.

Application deploys are **AWS CodePipeline + CodeBuild**, not GitHub Actions. See [`docs/cicd.md`](../docs/cicd.md).

## Resume-safe deploy (landing zone)

Laptop links drop. CloudFormation does **not** roll back just because `cdk deploy` lost TCP. Always use the wrapper, not a raw one-shot `cdk deploy` of the whole stage.

```bash
cd infra
npm install
make status          # inventory: stacks, VPC, KMS, secrets, S3, ECR
make deploy          # sandbox: skip matching stacks, update the rest, retry on timeouts
```

What `make deploy` does:

1. Reads **existing** CloudFormation stacks and related resources in London.
2. Bootstraps `CDKToolkit` in `eu-west-2` only if it is missing (Ireland’s toolkit is ignored).
3. Deploys **one stack at a time** in order: ECR → network → security → identity → data → compute → edge → observability → compliance → pipeline.
4. Runs `cdk diff --fail`. If there is no diff, **skips**.
5. If a stack is `CREATE_IN_PROGRESS` / `UPDATE_IN_PROGRESS`, **waits** instead of starting a second update.
6. If a create rolled back (`ROLLBACK_COMPLETE`), deletes that empty stack and recreates it.
7. Retries AWS/CDK calls on timeouts, resets, 429/503.

Re-run the same command after a drop. Already-complete stacks are skipped.

Prod:

```bash
CONFIRM=YES APP=minrv-ew2-prod make deploy
```

## Optional context

| Env | Meaning |
| --- | --- |
| `DOMAIN_NAME` | ACM + HTTPS on the public ALB |
| `HOSTED_ZONE_ID` / `HOSTED_ZONE_NAME` | DNS-validated cert |
| `WEB_IMAGE_TAG` / `SENTINEL_IMAGE_TAG` | Immutable ECR tags for a compute-stack update (services stay at desiredCount 0 until set) |
| `ENABLE_CLOUDFRONT=1` | Also bootstrap/deploy us-east-1 edge |
| `OPS_EMAIL` | SNS alarm subscription |
| `SKIP_REGIONAL_SECURITY=1` | Do not create GuardDuty/Config/Security Hub (set automatically if they already exist) |
| `GITHUB_CONNECTION_ARN` | Override the eu-west-2 CodeConnections ARN (must be the same region as the pipeline) |
| `COGNITO_CALLBACK_URL` | Extra hosted-UI callback (ALB DNS after first compute deploy) |
| `COGNITO_LOGOUT_URL` | Extra hosted-UI logout URL |

## After first deploy

1. In the AWS console, complete the **PENDING** GitHub connection `minrv-ew2-github` (eu-west-2) for `varannik/MinRVAtlas`.
2. Put Isometric tokens into `minrv/ew2/{stage}/isometric` (do not copy Ireland secrets).
3. Identity stack creates a **new** Cognito user pool in eu-west-2 (invite-only). After it is `CREATE_COMPLETE`, invite the first admin:

   ```bash
   SEED_EMAIL=you@4401.earth make seed-cognito
   ```

   Cognito allows `http://localhost…` only. A public ALB callback must be **https** (`DOMAIN_NAME` + ACM), then set `COGNITO_CALLBACK_URL` and re-run `make deploy`. Plain `http://*.elb.amazonaws.com` is rejected.
4. Push to GitHub, or `make pipeline-start`. Images are `apps/web/Dockerfile` and `apps/sentinel/backend/Dockerfile`.
5. Smoke: Next `GET /api/registry/requirements?projectId=fujairah-mineral`; Quality Console `/quality`; Sentinel `GET /api/health` via the **internal** ALB only.

Local Docker (`make docker-build`) does **not** deploy. `make deploy` updates CloudFormation only.

Do not expose port 8000 on the public ALB. Do not add a Sentinel UI task. Do not import `eu-west-1` `minrv-dev-*` stacks. Do not invalidate CloudFront `/*` on every backend deploy.
