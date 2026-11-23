import { spawnSync } from "node:child_process";
import { cfnStackName, REGION, type StageName } from "./config";

/**
 * The HTTPS sign-in and sign-out addresses a stage's web runs with now, so a deploy
 * that is not given COGNITO_CALLBACK_URL / COGNITO_LOGOUT_URL keeps them. Without
 * this, such a deploy would fall back to http://localhost:3000 for the web and drop
 * the HTTPS address from the Cognito app client, and sign-in would stop working.
 *
 * The sign-in address is the compute stack's CognitoRedirectUri output; the sign-out
 * address is the same origin's /login, as the web stack builds it for a domain name.
 * A stage whose compute stack does not exist yet (or still runs on localhost only)
 * gets nothing. Any other failure stops the synth rather than guess.
 */
export interface LiveCognitoUrls {
  callbackUrl?: string;
  logoutUrl?: string;
}

const cache = new Map<StageName, LiveCognitoUrls>();

export function liveCognitoUrls(stage: StageName): LiveCognitoUrls {
  const known = cache.get(stage);
  if (known) return known;
  const stackName = cfnStackName(stage, "compute");
  const result = spawnSync(
    "aws",
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].Outputs[?OutputKey=='CognitoRedirectUri'].OutputValue",
      "--region",
      REGION,
      "--output",
      "text",
    ],
    { encoding: "utf-8", env: process.env, timeout: 25_000 },
  );
  let urls: LiveCognitoUrls = {};
  if (result.status !== 0) {
    const error = (result.stderr ?? "").trim();
    if (!/does not exist/i.test(error)) {
      throw new Error(
        `Could not read the live sign-in address of ${stackName} (aws cloudformation describe-stacks): ` +
          `${error.slice(0, 300)}\nSet COGNITO_CALLBACK_URL and COGNITO_LOGOUT_URL to deploy without it.`,
      );
    }
  } else {
    urls = fromRedirectUri(result.stdout);
  }
  cache.set(stage, urls);
  return urls;
}

/** The addresses an HTTPS CognitoRedirectUri output stands for; nothing for localhost or an empty output. */
export function fromRedirectUri(output: string | undefined): LiveCognitoUrls {
  const value = (output ?? "").trim();
  if (!value.startsWith("https://") || value === "None") return {};
  const url = new URL(value);
  return { callbackUrl: value, logoutUrl: `${url.origin}/login` };
}
