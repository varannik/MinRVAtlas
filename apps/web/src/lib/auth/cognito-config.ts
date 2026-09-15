export type CognitoConfig = {
  userPoolId: string;
  clientId: string;
  clientSecret: string;
  domain: string;
  redirectUri: string;
  issuer: string;
};

export function getCognitoConfig(): CognitoConfig | null {
  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  const clientId = process.env.COGNITO_CLIENT_ID?.trim();
  const clientSecret = process.env.COGNITO_CLIENT_SECRET?.trim();
  const domain = process.env.COGNITO_DOMAIN?.trim()?.replace(/^https?:\/\//, "");
  const redirectUri =
    process.env.COGNITO_REDIRECT_URI?.trim() ||
    "http://localhost:3000/auth/callback";
  if (!userPoolId || !clientId || !clientSecret || !domain) return null;
  const issuer =
    process.env.COGNITO_ISSUER?.trim() ||
    `https://cognito-idp.${regionFromPool(userPoolId)}.amazonaws.com/${userPoolId}`;
  return { userPoolId, clientId, clientSecret, domain, redirectUri, issuer };
}

export function hostedAuthorizeUrl(
  cfg: CognitoConfig,
  state: string,
  challenge: string,
): string {
  const url = new URL(`https://${cfg.domain}/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function hostedLogoutUrl(cfg: CognitoConfig, logoutUri: string): string {
  const url = new URL(`https://${cfg.domain}/logout`);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("logout_uri", logoutUri);
  return url.toString();
}

function regionFromPool(userPoolId: string): string {
  const region = userPoolId.split("_")[0];
  return region || "eu-west-2";
}
