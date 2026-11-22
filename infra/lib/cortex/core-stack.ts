import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as pipes from "aws-cdk-lib/aws-pipes";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as avp from "aws-cdk-lib/aws-verifiedpermissions";
import { Construct } from "constructs";
import { cfnStackName, cortexJourneyTableName, cortexTenancyTableName, resourceName } from "../config";
import { Ew2Stack, type Ew2StackProps } from "../ew2-stack";

export interface CortexCoreStackProps extends Ew2StackProps {
  keyArn: string;
}

/**
 * Cortex core: who may see what (tenancy grants, Cedar policies), where
 * approval workflows keep their state, and the event bus everything else
 * reacts to.
 */
export class CortexCoreStack extends Ew2Stack {
  /** Tenants, projects and per-project grants. pk/sk, see lambda/tenancy.py. */
  public readonly tenancyTable: dynamodb.Table;
  /** LangGraph checkpoints (AWS DynamoDBSaver: PK/SK strings, ttl). Thread ids start "{tenant}#{project}#". */
  public readonly checkpointsTable: dynamodb.Table;
  /** Each project's journey (pk TENANT#<t>#PROJECT#<p>): sk JOURNEY, and CHANGE#<version> per change. */
  public readonly journeysTable: dynamodb.Table;
  public readonly eventBus: events.EventBus;
  public readonly scheduleGroup: scheduler.ScheduleGroup;
  public readonly policyStore: avp.CfnPolicyStore;

  constructor(scope: Construct, id: string, props: CortexCoreStackProps) {
    super(scope, id, {
      ...props,
      stackName: cfnStackName(props.cfg.stageName, "cortex-core"),
      description: `minrv-ew2 ${props.cfg.stageName} Cortex tenancy, workflow state, events, Cedar policies`,
    });
    const { cfg } = props;
    const key = kms.Key.fromKeyArn(this, "Cmk", props.keyArn);
    const removal = cfg.deletionProtection ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    this.tenancyTable = new dynamodb.Table(this, "Tenancy", {
      tableName: cortexTenancyTableName(cfg.stageName),
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: cfg.deletionProtection,
      removalPolicy: removal,
    });

    this.checkpointsTable = new dynamodb.Table(this, "Checkpoints", {
      tableName: resourceName(cfg.stageName, "cortex-checkpoints"),
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: cfg.deletionProtection,
      removalPolicy: removal,
    });

    // The web reads and writes a project's items only through the tenant session,
    // whose policy limits it to keys starting with that tenant and project
    // (cortex-knowledge stack). Change records are never rewritten, so the table
    // is the project's audit trail of who answered what, and when.
    this.journeysTable = new dynamodb.Table(this, "Journeys", {
      tableName: cortexJourneyTableName(cfg.stageName),
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      // Change records flow from here to the event bus (JourneyChanges below).
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: cfg.deletionProtection,
      removalPolicy: removal,
    });

    // Events carry ids and keys, never document text. AWS-owned encryption: the shared
    // CMK's key policy (security stack) does not grant EventBridge, and a bus on a
    // key it cannot use fails at deploy.
    this.eventBus = new events.EventBus(this, "Bus", {
      eventBusName: resourceName(cfg.stageName, "cortex"),
    });
    // The search index and the graphs are projections; they are rebuilt by replaying this archive.
    this.eventBus.archive("Archive", {
      archiveName: resourceName(cfg.stageName, "cortex-events"),
      description: "Every Cortex domain event, for replay into the index and graphs",
      eventPattern: { account: [cdk.Stack.of(this).account] },
      retention: cdk.Duration.days(cfg.cortex.eventArchiveDays),
    });

    // Every journey change record onto the bus as JourneyChanged: the graph writer
    // (cortex-graph stack) links filed documents to their tasks, and the archive
    // can replay them to rebuild the graph. The stream is written in the same
    // transaction as the change, so no change is missed.
    const pipeRole = new iam.Role(this, "JourneyChangesRole", {
      assumedBy: new iam.ServicePrincipal("pipes.amazonaws.com", {
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    });
    this.journeysTable.grantStreamRead(pipeRole);
    this.eventBus.grantPutEventsTo(pipeRole);
    const journeyChanges = new pipes.CfnPipe(this, "JourneyChanges", {
      name: resourceName(cfg.stageName, "cortex-journey-changes"),
      description: "Journey change records onto the Cortex event bus (JourneyChanged)",
      roleArn: pipeRole.roleArn,
      source: this.journeysTable.tableStreamArn!,
      sourceParameters: {
        dynamoDbStreamParameters: { startingPosition: "LATEST", batchSize: 1, maximumRetryAttempts: 10 },
        filterCriteria: {
          filters: [
            {
              pattern: JSON.stringify({ eventName: ["INSERT"], dynamodb: { NewImage: { sk: { S: [{ prefix: "CHANGE#" }] } } } }),
            },
          ],
        },
      },
      target: this.eventBus.eventBusArn,
      targetParameters: {
        eventBridgeEventBusParameters: { source: "minrv.cortex.journey", detailType: "JourneyChanged" },
      },
    });
    journeyChanges.node.addDependency(pipeRole);

    // One-off reminders and deadlines that approval workflows create while they wait.
    this.scheduleGroup = new scheduler.ScheduleGroup(this, "Workflows", {
      scheduleGroupName: resourceName(cfg.stageName, "cortex-workflows"),
      removalPolicy: removal,
    });

    this.policyStore = new avp.CfnPolicyStore(this, "Permissions", {
      description: `minrv-ew2 ${cfg.stageName} Cortex app permissions (tenant and project boundaries)`,
      validationSettings: { mode: "STRICT" },
      deletionProtection: { mode: cfg.deletionProtection ? "ENABLED" : "DISABLED" },
      schema: { cedarJson: JSON.stringify(CEDAR_SCHEMA) },
    });
    for (const [name, policy] of Object.entries(CEDAR_POLICIES)) {
      const resource = new avp.CfnPolicy(this, `Policy${name}`, {
        policyStoreId: this.policyStore.attrPolicyStoreId,
        definition: { static: { description: policy.description, statement: policy.statement } },
      });
      resource.addDependency(this.policyStore);
    }

    new cdk.CfnOutput(this, "TenancyTableName", { value: this.tenancyTable.tableName });
    new cdk.CfnOutput(this, "CheckpointsTableName", { value: this.checkpointsTable.tableName });
    new cdk.CfnOutput(this, "EventBusName", { value: this.eventBus.eventBusName });
    new cdk.CfnOutput(this, "ScheduleGroupName", { value: this.scheduleGroup.scheduleGroupName });
    new cdk.CfnOutput(this, "PolicyStoreId", { value: this.policyStore.attrPolicyStoreId });
  }
}

/** Cedar schema for the MinRV app (Amazon Verified Permissions). */
export const CEDAR_SCHEMA = {
  MinRV: {
    entityTypes: {
      User: {
        shape: {
          type: "Record",
          attributes: {
            tenant_id: { type: "String" },
            role: { type: "String" },
            project_ids: { type: "Set", element: { type: "String" } },
          },
        },
      },
      Project: {
        shape: {
          type: "Record",
          attributes: {
            tenant_id: { type: "String" },
            project_id: { type: "String" },
          },
        },
      },
      Knowledge: {
        shape: {
          type: "Record",
          attributes: {
            scope: { type: "String" },
            tenant_id: { type: "String", required: false },
            project_id: { type: "String", required: false },
          },
        },
      },
    },
    actions: {
      ReadProject: { appliesTo: { principalTypes: ["User"], resourceTypes: ["Project"] } },
      ProposeChange: { appliesTo: { principalTypes: ["User"], resourceTypes: ["Project"] } },
      ApproveChange: { appliesTo: { principalTypes: ["User"], resourceTypes: ["Project"] } },
      ReadKnowledge: { appliesTo: { principalTypes: ["User"], resourceTypes: ["Knowledge"] } },
      AddKnowledge: { appliesTo: { principalTypes: ["User"], resourceTypes: ["Knowledge"] } },
    },
  },
};

const TENANT_WIDE = `["tenant_admin", "platform_admin"].contains(principal.role)`;

/** Cedar policies. The forbid wins over every permit: nothing crosses a tenant. */
export const CEDAR_POLICIES: Record<string, { description: string; statement: string }> = {
  TenantBoundary: {
    description: "Nothing that belongs to one tenant is ever available to another",
    statement: `forbid (principal, action, resource)
when { resource has tenant_id && resource.tenant_id != principal.tenant_id };`,
  },
  ReadProject: {
    description: "Members read their projects; tenant admins read every project in their tenant",
    statement: `permit (principal, action == MinRV::Action::"ReadProject", resource)
when {
  resource.tenant_id == principal.tenant_id &&
  (${TENANT_WIDE} || principal.project_ids.contains(resource.project_id))
};`,
  },
  ProposeChange: {
    description: "Operators, quality engineers and tenant admins propose changes on their projects",
    statement: `permit (principal, action == MinRV::Action::"ProposeChange", resource)
when {
  resource.tenant_id == principal.tenant_id &&
  ["tenant_admin", "quality_engineer", "operator"].contains(principal.role) &&
  (principal.role == "tenant_admin" || principal.project_ids.contains(resource.project_id))
};`,
  },
  ApproveChange: {
    description: "Quality engineers and tenant admins approve changes on their projects",
    statement: `permit (principal, action == MinRV::Action::"ApproveChange", resource)
when {
  resource.tenant_id == principal.tenant_id &&
  ["tenant_admin", "quality_engineer"].contains(principal.role) &&
  (principal.role == "tenant_admin" || principal.project_ids.contains(resource.project_id))
};`,
  },
  ReadKnowledge: {
    description: "Shared knowledge for everyone; tenant knowledge for the tenant; project knowledge for its members",
    statement: `permit (principal, action == MinRV::Action::"ReadKnowledge", resource)
when {
  resource.scope == "shared" ||
  (resource has tenant_id && resource.tenant_id == principal.tenant_id &&
    (resource.scope == "tenant" || ${TENANT_WIDE} ||
      (resource has project_id && principal.project_ids.contains(resource.project_id))))
};`,
  },
  AddKnowledge: {
    description: "Tenant admins add tenant knowledge; project members add project knowledge. Shared knowledge comes only from the platform pipeline",
    statement: `permit (principal, action == MinRV::Action::"AddKnowledge", resource)
when {
  resource has tenant_id && resource.tenant_id == principal.tenant_id &&
  ((resource.scope == "tenant" && principal.role == "tenant_admin") ||
   (resource.scope == "project" && resource has project_id &&
     ["tenant_admin", "quality_engineer", "operator"].contains(principal.role) &&
     (principal.role == "tenant_admin" || principal.project_ids.contains(resource.project_id))))
};`,
  },
};
