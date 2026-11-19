"""Step Functions task: run Bedrock Data Automation on one admitted document.

  action=start   start an async BDA job on the knowledge bucket copy
  action=status  the job's status and, once it succeeded, where its job metadata is

BDA runs through the London data automation profile (BDA_PROFILE_ARN), which
keeps processing in eu-west-2. Output goes to the parsed bucket under
bda/<doc_id>/; the chunk task turns it into one passage per rule.
"""

import os

_client = None


def client():
    global _client
    if _client is None:
        import boto3

        _client = boto3.client("bedrock-data-automation-runtime")
    return _client


def start(document):
    source = f"s3://{os.environ['KNOWLEDGE_BUCKET']}/{document['key']}"
    output = f"s3://{os.environ['PARSED_BUCKET']}/bda/{document['doc_id']}"  # BDA adds /<job id>/ itself
    response = client().invoke_data_automation_async(
        inputConfiguration={"s3Uri": source},
        outputConfiguration={"s3Uri": output},
        dataAutomationConfiguration={
            "dataAutomationProjectArn": os.environ["BDA_PROJECT_ARN"],
            "stage": "LIVE",
        },
        dataAutomationProfileArn=os.environ["BDA_PROFILE_ARN"],
    )
    return {"invocationArn": response["invocationArn"], "status": "Created", "jobMetadata": None, "error": None}


def status(invocation_arn):
    response = client().get_data_automation_status(invocationArn=invocation_arn)
    error = response.get("errorMessage")
    if error and response.get("errorType"):
        error = f"{response['errorType']}: {error}"
    return {
        "invocationArn": invocation_arn,
        # Created | InProgress | Success | ServiceError | ClientError
        "status": response.get("status"),
        "jobMetadata": (response.get("outputConfiguration") or {}).get("s3Uri"),
        "error": error,
    }


def handler(event, _context):
    action = event.get("action")
    if action == "start":
        return start(event["document"])
    if action == "status":
        return status(event["invocationArn"])
    raise ValueError(f"Unknown action {action!r}")
