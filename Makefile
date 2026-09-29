# 3DMinRV + Data Sentinel — eu-west-2
# Delegates to infra/ (AWS CDK). Real AWS only — no LocalStack.
# Local UI: npm run dev (apps/web). Local engine: npm run sentinel:up.
# Application CI/CD is AWS CodePipeline — see docs/cicd.md. GitHub Actions does not deploy.

ACCOUNT    ?= 625239230739
REGION     ?= eu-west-2
APP        ?= minrv-ew2-sandbox
CONFIRM    ?=
ENABLE_CLOUDFRONT ?= 0
AWS_PROFILE ?=
IMAGE_TAG  ?=
WEB_IMAGE_TAG ?=
SENTINEL_IMAGE_TAG ?=
SCALE_TO_ZERO ?=
STREAM_TENANT_ID ?=
STREAM_REGISTRY_ID ?=
STREAM_PROJECT_ID ?=
STREAM_TENANT ?=
STREAM_REGISTRY ?=
STREAM_PROJECT ?=
STREAM_FROM ?=
STREAM_TO ?=
STREAM_PACK ?=
STREAM_LIST ?=
SERVICE    ?= web
TASK_DEFINITION ?=
SINCE      ?= 1h

.PHONY: bootstrap deploy diff destroy synth status inventory push-images \
	ci docker-build docker-push pipeline pipeline-start pipeline-status \
	ecs-status logs rollback seed-stream-s3 create-cognito-user

# Empty AWS_PROFILE= on the child command line is auto-exported and makes
# `aws` look up a profile named "". Same for IMAGE_TAG vs the git-SHA default.
bootstrap deploy diff destroy synth status inventory push-images \
ci docker-build docker-push pipeline pipeline-start pipeline-status \
ecs-status logs rollback seed-stream-s3 create-cognito-user:
	$(MAKE) -C infra $@ \
		ACCOUNT=$(ACCOUNT) \
		REGION=$(REGION) \
		APP=$(APP) \
		CONFIRM=$(CONFIRM) \
		ENABLE_CLOUDFRONT=$(ENABLE_CLOUDFRONT) \
		$(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) \
		$(if $(IMAGE_TAG),IMAGE_TAG=$(IMAGE_TAG)) \
		$(if $(WEB_IMAGE_TAG),WEB_IMAGE_TAG=$(WEB_IMAGE_TAG)) \
		$(if $(SENTINEL_IMAGE_TAG),SENTINEL_IMAGE_TAG=$(SENTINEL_IMAGE_TAG)) \
		$(if $(SCALE_TO_ZERO),SCALE_TO_ZERO=$(SCALE_TO_ZERO)) \
		$(if $(STREAM_TENANT_ID),STREAM_TENANT_ID=$(STREAM_TENANT_ID)) \
		$(if $(STREAM_REGISTRY_ID),STREAM_REGISTRY_ID=$(STREAM_REGISTRY_ID)) \
		$(if $(STREAM_PROJECT_ID),STREAM_PROJECT_ID=$(STREAM_PROJECT_ID)) \
		$(if $(STREAM_TENANT),STREAM_TENANT=$(STREAM_TENANT)) \
		$(if $(STREAM_REGISTRY),STREAM_REGISTRY=$(STREAM_REGISTRY)) \
		$(if $(STREAM_PROJECT),STREAM_PROJECT=$(STREAM_PROJECT)) \
		$(if $(STREAM_FROM),STREAM_FROM=$(STREAM_FROM)) \
		$(if $(STREAM_TO),STREAM_TO=$(STREAM_TO)) \
		$(if $(STREAM_PACK),STREAM_PACK=$(STREAM_PACK)) \
		$(if $(STREAM_LIST),STREAM_LIST=$(STREAM_LIST)) \
		SERVICE=$(SERVICE) \
		TASK_DEFINITION=$(TASK_DEFINITION) \
		SINCE=$(SINCE)
