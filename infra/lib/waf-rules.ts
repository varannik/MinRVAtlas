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

/** Rate-limit Cognito callback and token routes on the public ALB. */
export function authRateLimitRule(
  priority: number,
  limit = 100,
): wafv2.CfnWebACL.RuleProperty {
  return {
    name: "AuthRateLimit",
    priority,
    action: { block: {} },
    statement: {
      rateBasedStatement: {
        limit,
        aggregateKeyType: "IP",
        scopeDownStatement: {
          byteMatchStatement: {
            searchString: "/auth",
            fieldToMatch: { uriPath: {} },
            positionalConstraint: "STARTS_WITH",
            textTransformations: [{ priority: 0, type: "LOWERCASE" }],
          },
        },
      },
    },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: "AuthRateLimit",
      sampledRequestsEnabled: true,
    },
  };
}

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
