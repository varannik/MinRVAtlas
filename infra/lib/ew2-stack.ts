import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { AZS, PROJECT, type StageConfig } from "./config";

export interface Ew2StackProps extends cdk.StackProps {
  cfg: StageConfig;
}

/**
 * London stacks always use the three eu-west-2 AZs so `cdk synth` does not
 * call EC2 DescribeAvailabilityZones (important on a flaky link).
 */
export class Ew2Stack extends cdk.Stack {
  public readonly cfg: StageConfig;

  constructor(scope: Construct, id: string, props: Ew2StackProps) {
    super(scope, id, {
      ...props,
      terminationProtection: props.cfg.deletionProtection,
    });
    this.cfg = props.cfg;

    cdk.Tags.of(this).add("Project", PROJECT);
    cdk.Tags.of(this).add("Stage", props.cfg.stageName);
    cdk.Tags.of(this).add("ManagedBy", "cdk");
  }

  public get availabilityZones(): string[] {
    return [...AZS];
  }
}
