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
SERVICE    ?= web
TASK_DEFINITION ?=
SINCE      ?= 1h

.PHONY: bootstrap deploy diff destroy synth status inventory push-images \
	ci docker-build docker-push pipeline pipeline-start pipeline-status \
	ecs-status logs rollback

bootstrap deploy diff destroy synth status inventory push-images \
ci docker-build docker-push pipeline pipeline-start pipeline-status \
ecs-status logs rollback:
	$(MAKE) -C infra $@ \
		ACCOUNT=$(ACCOUNT) \
		REGION=$(REGION) \
		APP=$(APP) \
		CONFIRM=$(CONFIRM) \
		ENABLE_CLOUDFRONT=$(ENABLE_CLOUDFRONT) \
		AWS_PROFILE=$(AWS_PROFILE) \
		IMAGE_TAG=$(IMAGE_TAG) \
		SERVICE=$(SERVICE) \
		TASK_DEFINITION=$(TASK_DEFINITION) \
		SINCE=$(SINCE)
