import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  isBrowserSameOrigin,
  sealSession,
  sessionCookieOptions,
  sessionSecret,
  type SessionPayload,
} from "@/lib/auth/session";
import { CONVERSATION_ID, questionProblem } from "@/lib/cortex/ask";
import { accessTokenFor, agentUrl, runtimeSessionId } from "@/lib/cortex/agent.server";
import { CortexRefusal, cortexEnv, currentSession, describeFailure, requireProject } from "@/lib/cortex/intake.server";

/**
 * POST { projectId, question, conversationId }: ask Cortex about a project.
 *
 * Checks the project grant, then calls the Cortex agent with the user's own
 * access token and streams its answer back as server-sent events
 * (apps/cortex-agent/README.md lists them).
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" };
/** Quiet streams are closed by load balancers after 60 seconds; a comment line keeps them open. */
const KEEP_ALIVE_MS = 15_000;
const encoder = new TextEncoder();

function refuse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

/** The agent's stream, with keep-alives while it thinks and a closing event if the connection drops. */
function relay(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let open = true;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (chunk: Uint8Array) => {
        if (open) controller.enqueue(chunk);
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          push(encoder.encode(": keep-alive\n\n"));
          arm();
        }, KEEP_ALIVE_MS);
      };
      arm();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            push(value);
            arm();
          }
        } catch {
          const event = { type: "error", message: "The connection to Cortex dropped. Ask again." };
          push(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } finally {
          clearTimeout(timer);
          if (open) controller.close();
          open = false;
        }
      })();
    },
    cancel(reason) {
      open = false;
      clearTimeout(timer);
      return reader.cancel(reason);
    },
  });
}

function upstreamFailure(status: number): { message: string; status: number } {
  if (status === 401 || status === 403) return { message: "Cortex did not accept your sign-in. Sign in again.", status: 401 };
  if (status === 404) return { message: "Ask Cortex is not deployed on this environment yet.", status: 503 };
  if (status === 429) return { message: "Cortex is busy. Try again in a minute.", status: 429 };
  return { message: "Cortex could not answer. Try again.", status: 502 };
}

/** Cognito rotated the refresh token: the old one stops working, so the cookie must carry the new one. */
async function keepRotation(session: SessionPayload, rotated: string | undefined): Promise<void> {
  const secret = sessionSecret();
  if (!rotated || !secret) return;
  const remaining = session.exp - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return;
  const sealed = await sealSession({ ...session, refreshToken: rotated }, secret);
  (await cookies()).set(SESSION_COOKIE, sealed, sessionCookieOptions(remaining));
}

export async function POST(request: NextRequest) {
  if (!isBrowserSameOrigin(request)) return refuse("Cross-site request refused.", 403);
  const session = await currentSession();
  if (!session) return refuse("Unauthorized", 401);
  const env = cortexEnv();
  if (!env) return refuse("Cortex is not set up on this deployment.", 503);

  const body = (await request.json().catch(() => null)) as {
    projectId?: unknown;
    question?: unknown;
    conversationId?: unknown;
  } | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId : "";
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const problem = questionProblem(question);
  if (problem) return refuse(problem, 400);
  if (!CONVERSATION_ID.test(conversationId)) return refuse("Start a new conversation.", 400);

  try {
    await requireProject(session, env, projectId);
    const url = await agentUrl();
    if (!url) throw new CortexRefusal("Ask Cortex is not deployed on this environment yet.", 503);
    const { token, rotated } = await accessTokenFor(session);
    await keepRotation(session, rotated);

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": runtimeSessionId(session.sub, conversationId),
      },
      body: JSON.stringify({ question, project_id: projectId, conversation_id: conversationId }),
      signal: request.signal,
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      console.error("cortex ask upstream", upstream.status, (await upstream.text().catch(() => "")).slice(0, 200));
      const failure = upstreamFailure(upstream.status);
      return refuse(failure.message, failure.status);
    }
    return new Response(relay(upstream.body), {
      headers: {
        ...NO_STORE,
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    const failure = describeFailure(error);
    if (failure.status >= 500) console.error("cortex ask", (error as Error)?.name);
    return refuse(failure.message, failure.status);
  }
}
