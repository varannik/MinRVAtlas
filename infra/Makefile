ACCOUNT    ?= 625239230739
REGION     ?= eu-west-2
APP        ?= minrv-ew2-sandbox
CONFIRM    ?=
ENABLE_CLOUDFRONT ?= 0
AWS_PROFILE ?=
SERVICE    ?= web
TASK_DEFINITION ?=
SINCE      ?= 1h
ROOT       := $(abspath ..)
IMAGE_TAG  ?= $(shell git -C $(ROOT) rev-parse HEAD 2>/dev/null || echo local)
WEB_REPO   ?= minrv-ew2-web
SENTINEL_REPO ?= minrv-ew2-sentinel
ECR_REGISTRY ?= $(ACCOUNT).dkr.ecr.$(REGION).amazonaws.com

export ACCOUNT REGION APP CONFIRM ENABLE_CLOUDFRONT
export SERVICE TASK_DEFINITION SINCE IMAGE_TAG
export CDK_DEFAULT_ACCOUNT := $(ACCOUNT)
export CDK_DEFAULT_REGION  := $(REGION)
export AWS_REGION          := $(REGION)
export AWS_DEFAULT_REGION  := $(REGION)

# Command-line AWS_PROFILE= is auto-exported. An empty value makes the AWS CLI
# look up a profile named "" ("The config profile () could not be found").
ifeq ($(AWS_PROFILE),)
unexport AWS_PROFILE
else
export AWS_PROFILE
endif

.PHONY: deps bootstrap status inventory synth diff deploy destroy push-images \
	ci docker-build docker-push pipeline pipeline-start pipeline-status \
	ecs-status logs rollback identity seed-cognito

deps:
	npm install

identity:
	aws sts get-caller-identity

bootstrap:
	npx ts-node --prefer-ts-exts scripts/resume-deploy.ts bootstrap

status inventory:
	npx ts-node --prefer-ts-exts scripts/resume-deploy.ts status

synth:
	npx cdk synth minrv-ew2-ecr minrv-ew2-sandbox-pipeline minrv-ew2-prod-pipeline '$(APP)/*'

diff:
	npx ts-node --prefer-ts-exts scripts/resume-deploy.ts diff

# CloudFormation landing zone only. Does not start CodePipeline.
deploy:
	npx ts-node --prefer-ts-exts scripts/resume-deploy.ts deploy

destroy:
	npx ts-node --prefer-ts-exts scripts/resume-deploy.ts destroy

# Local tests — does not build images or deploy.
ci:
	cd $(ROOT)/apps/web && npm ci && npx tsc --noEmit && npm run lint
	cd $(ROOT)/apps/sentinel/backend && python3 -m pip install -q -r requirements.txt pytest && ENVIRONMENT=test python3 -m pytest tests/ -q --tb=short

# linux/amd64 images matching CI. Does not login, push, or deploy.
docker-build:
	docker build --platform linux/amd64 -f $(ROOT)/apps/web/Dockerfile \
		-t $(ECR_REGISTRY)/$(WEB_REPO):$(IMAGE_TAG) -t minrv-web:local \
		$(ROOT)/apps/web
	docker build --platform linux/amd64 -f $(ROOT)/apps/sentinel/backend/Dockerfile \
		-t $(ECR_REGISTRY)/$(SENTINEL_REPO):$(IMAGE_TAG) -t minrv-sentinel:local \
		$(ROOT)/apps/sentinel/backend
	@echo "Built $(ECR_REGISTRY)/$(WEB_REPO):$(IMAGE_TAG) and $(ECR_REGISTRY)/$(SENTINEL_REPO):$(IMAGE_TAG)"
	@echo "Local aliases: minrv-web:local minrv-sentinel:local"
	@echo "This did not push or deploy. Use make docker-push or make pipeline-start."

# Push immutable Git-SHA tags to ECR. Does not update ECS.
docker-push: identity
	IMAGE_TAG=$(IMAGE_TAG) npx ts-node --prefer-ts-exts scripts/push-images.ts

push-images: docker-push

pipeline pipeline-status:
	npx ts-node --prefer-ts-exts scripts/cicd-ops.ts pipeline-status

pipeline-start: identity
	npx ts-node --prefer-ts-exts scripts/cicd-ops.ts pipeline-start

ecs-status: identity
	npx ts-node --prefer-ts-exts scripts/cicd-ops.ts ecs-status

logs: identity
	npx ts-node --prefer-ts-exts scripts/cicd-ops.ts logs

rollback: identity
	npx ts-node --prefer-ts-exts scripts/cicd-ops.ts rollback

# After minrv-ew2-{stage}-identity is CREATE_COMPLETE. Does not create the pool.
seed-cognito:
	npx ts-node --prefer-ts-exts scripts/seed-cognito.ts
