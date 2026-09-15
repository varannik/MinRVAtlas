export const OPERATOR_ROLES = [
  "platform_admin",
  "tenant_admin",
  "quality_engineer",
  "operator",
  "viewer",
] as const;

export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export function isOperatorRole(value: string): value is OperatorRole {
  return (OPERATOR_ROLES as readonly string[]).includes(value);
}

export function roleFromGroups(groups: string[]): OperatorRole {
  return OPERATOR_ROLES.find((role) => groups.includes(role)) ?? "viewer";
}
