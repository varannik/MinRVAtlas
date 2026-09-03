import type * as wafv2 from "aws-cdk-lib/aws-wafv2";

/**
 * CRS blocks JSON/CSV multipart bodies. Count these on /api uploads (Quality + pipeline).
 * Other CRS rules stay in block mode.
 */
export const CRS_API_BODY_OVERRIDES: wafv2.CfnWebACL.RuleActionOverrideProperty[] =
  [
    { name: "SizeRestrictions_BODY", actionToUse: { count: {} } },
    { name: "CrossSiteScripting_BODY", actionToUse: { count: {} } },
  ];

export function managedRule(
  name: string,
  priority: number,
  opts?: { bodyOverrides?: boolean },
): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} },
    statement: {
      managedRuleGroupStatement: {
        vendorName: "AWS",
        name,
        ...(opts?.bodyOverrides
          ? { ruleActionOverrides: CRS_API_BODY_OVERRIDES }
          : {}),
      },
    },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: name,
      sampledRequestsEnabled: true,
    },
  };
}
