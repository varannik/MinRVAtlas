# Cortex agent for Amazon Bedrock AgentCore Runtime.
# The runtime needs linux/arm64 and an HTTP server on port 8080 with /ping and /invocations.
FROM public.ecr.aws/docker/library/python:3.13-slim

# DOCKER_CONTAINER makes the AgentCore app listen on 0.0.0.0 (the runtime has no /.dockerenv).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DOCKER_CONTAINER=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY cortex_agent ./cortex_agent

RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 8080
CMD ["python", "-m", "cortex_agent.main"]
