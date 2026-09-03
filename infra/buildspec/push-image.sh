#!/usr/bin/env bash
# Build + push one immutable Git-SHA image. Fail the build on test or docker errors.
set -euo pipefail

: "${AWS_ACCOUNT_ID:?}"
: "${AWS_DEFAULT_REGION:=${AWS_REGION:-eu-west-2}}"
: "${ECR_REPOSITORY:?}"
: "${CONTAINER_NAMES:?}"
: "${DOCKERFILE:?}"
: "${DOCKER_CONTEXT:?}"
: "${APP_KIND:?}"
: "${STAGE:=unknown}"
: "${ECS_CLUSTER:=unknown}"

TAG="${CODEBUILD_RESOLVED_SOURCE_VERSION:-}"
if [[ -z "${TAG}" ]]; then
  echo "CODEBUILD_RESOLVED_SOURCE_VERSION is empty; cannot tag an immutable image" >&2
  exit 1
fi
if [[ "${TAG}" == "latest" ]]; then
  echo "Refusing to use mutable tag 'latest'" >&2
  exit 1
fi

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_DEFAULT_REGION}.amazonaws.com"
REPO_URI="${REGISTRY}/${ECR_REPOSITORY}"
IMAGE_TAG_URI="${REPO_URI}:${TAG}"

echo "Commit SHA=${TAG}"
echo "ECR repository=${ECR_REPOSITORY}"
echo "Image tag URI=${IMAGE_TAG_URI}"
echo "ECS cluster=${ECS_CLUSTER}"
echo "Stage=${STAGE}"
echo "Containers=${CONTAINER_NAMES}"
echo "CodeBuild id=${CODEBUILD_BUILD_ID:-local}"

run_tests() {
  if [[ "${APP_KIND}" == "web" ]]; then
    echo "=== web lint + typecheck ==="
    (cd apps/web && npm ci && npx tsc --noEmit && npm run lint)
    return
  fi
  echo "=== sentinel unit tests ==="
  python3 -m pip install -q -r apps/sentinel/backend/requirements.txt
  python3 -m pip install -q pytest
  (cd apps/sentinel/backend && ENVIRONMENT=test python3 -m pytest tests/ -q --tb=short)
}

run_tests

echo "=== ECR login ==="
aws ecr get-login-password --region "${AWS_DEFAULT_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

if aws ecr describe-images \
  --repository-name "${ECR_REPOSITORY}" \
  --image-ids "imageTag=${TAG}" \
  --region "${AWS_DEFAULT_REGION}" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists (immutable) — skip docker build/push"
else
  echo "=== docker build ${IMAGE_TAG_URI} ==="
  export DOCKER_BUILDKIT=1
  docker build \
    --platform linux/amd64 \
    -f "${DOCKERFILE}" \
    -t "${IMAGE_TAG_URI}" \
    "${DOCKER_CONTEXT}"
  echo "=== docker push ${IMAGE_TAG_URI} ==="
  docker push "${IMAGE_TAG_URI}"
fi

DIGEST="$(aws ecr describe-images \
  --repository-name "${ECR_REPOSITORY}" \
  --image-ids "imageTag=${TAG}" \
  --region "${AWS_DEFAULT_REGION}" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"

if [[ -z "${DIGEST}" || "${DIGEST}" == "None" ]]; then
  echo "Failed to resolve image digest for ${IMAGE_TAG_URI}" >&2
  exit 1
fi

IMAGE_URI="${IMAGE_TAG_URI}@${DIGEST}"
echo "IMAGE_URI=${IMAGE_URI}"
echo "IMAGE_DIGEST=${DIGEST}"

IFS=',' read -r -a NAMES <<< "${CONTAINER_NAMES}"
for name in "${NAMES[@]}"; do
  python3 - "${name}" "${IMAGE_URI}" <<'PY'
import json, sys
name, uri = sys.argv[1], sys.argv[2]
path = f"imagedefinitions-{name}.json"
with open(path, "w", encoding="utf-8") as fh:
    json.dump([{"name": name, "imageUri": uri}], fh)
print(f"wrote {path}")
PY
done
