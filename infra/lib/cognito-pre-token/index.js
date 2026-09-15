"use strict";

const KNOWN = [
  "platform_admin",
  "tenant_admin",
  "quality_engineer",
  "operator",
  "viewer",
];

exports.handler = async (event) => {
  const attrs = event.request.userAttributes || {};
  const tenant = attrs["custom:tenant_id"] || "";
  const groups =
    (event.request.groupConfiguration &&
      event.request.groupConfiguration.groupsToOverride) ||
    [];
  const role = KNOWN.find((g) => groups.includes(g)) || "viewer";
  const claims = { tenant_id: tenant, role };
  event.response = event.response || {};
  event.response.claimsAndScopeOverrideDetails = {
    idTokenGeneration: { claimsToAddOrOverride: claims },
    accessTokenGeneration: { claimsToAddOrOverride: claims },
  };
  return event;
};
