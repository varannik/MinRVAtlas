"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

const FIELD =
  "mt-1.5 h-11 w-full rounded-2xl bg-earth/45 px-3.5 text-sm text-calcite outline-none ring-1 ring-calcite/20 placeholder:text-calcite/35 focus:ring-olivine/55";

type Step = "login" | "forgot" | "confirm" | "new-password" | "mfa";

type SessionJson = {
  ok?: boolean;
  error?: string;
  redirect?: string;
  challenge?: string;
  session?: string;
  passwordReset?: boolean;
};

type PasswordJson = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export function LandingSignIn({
  open,
  from,
  error,
  cognito,
  devAllowed,
  devEmail,
  onClose,
}: {
  open: boolean;
  from?: string;
  error?: string;
  cognito: boolean;
  devAllowed: boolean;
  devEmail?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState(devEmail ?? "");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [challengeSession, setChallengeSession] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const shown = message || (step === "login" ? error : "") || "";
  const copy = copyFor(step);

  const close = useCallback(() => {
    setStep("login");
    setPassword("");
    setNewPassword("");
    setCode("");
    setChallengeSession("");
    setMessage("");
    setPending(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      if (step === "forgot") {
        await requestReset();
        return;
      }
      if (step === "confirm") {
        await confirmReset();
        return;
      }
      await signIn();
    } catch {
      setMessage("Could not reach MinRV");
    } finally {
      setPending(false);
    }
  }

  async function signIn() {
    const payload: Record<string, string | undefined> = { email, from };
    if (step === "new-password") {
      payload.session = challengeSession;
      payload.challenge = "NEW_PASSWORD_REQUIRED";
      payload.newPassword = newPassword;
    } else if (step === "mfa") {
      payload.session = challengeSession;
      payload.challenge = "SOFTWARE_TOKEN_MFA";
      payload.code = code;
    } else {
      payload.password = password;
    }
    const json = await postJson<SessionJson>("/auth/session", payload);
    if (json.passwordReset) {
      setMessage(json.error || "Reset your password to continue");
      setStep("forgot");
      return;
    }
    if (json.challenge === "NEW_PASSWORD_REQUIRED" && json.session) {
      setChallengeSession(json.session);
      setNewPassword("");
      setStep("new-password");
      return;
    }
    if (json.challenge === "SOFTWARE_TOKEN_MFA" && json.session) {
      setChallengeSession(json.session);
      setCode("");
      setStep("mfa");
      return;
    }
    if (json.error || !json.ok) {
      setMessage(json.error || "Could not sign in");
      return;
    }
    router.replace(json.redirect || "/");
    router.refresh();
  }

  async function requestReset() {
    const json = await postJson<PasswordJson>("/auth/password", {
      action: "forgot",
      email,
    });
    if (json.error) {
      setMessage(json.error);
      return;
    }
    setCode("");
    setNewPassword("");
    setMessage(json.message || "If an account exists, a reset code has been sent.");
    setStep("confirm");
  }

  async function confirmReset() {
    const json = await postJson<PasswordJson>("/auth/password", {
      action: "confirm",
      email,
      code,
      password: newPassword,
    });
    if (json.error || !json.ok) {
      setMessage(json.error || "Could not update the password");
      return;
    }
    setPassword("");
    setNewPassword("");
    setCode("");
    setMessage("Password updated. Sign in to continue.");
    setStep("login");
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <button
        type="button"
        aria-label="Close sign in"
        className="pointer-events-auto absolute inset-0 cursor-default bg-rock/20"
        onClick={close}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="landing-sign-in pointer-events-auto absolute top-1/2 left-[min(6vw,4.5rem)] w-[min(26.5rem,86vw)] -translate-y-1/2 rounded-3xl p-6 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.34em] text-olivine uppercase">
              Operator access
            </p>
            <h2 id={titleId} className="font-display mt-2 text-3xl tracking-tight text-calcite">
              {copy.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex size-8 items-center justify-center rounded-full text-calcite/70 ring-1 ring-calcite/20 hover:text-calcite"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-calcite/75">{copy.body}</p>
        {shown ? (
          <p className="mt-4 text-[12px] text-[#f0a89a]" role="alert">
            {shown}
          </p>
        ) : null}
        {!cognito && !devAllowed ? (
          <p className="mt-5 text-sm text-calcite/70">Cognito is not configured.</p>
        ) : (
          <form className="mt-6 space-y-3.5" onSubmit={submit}>
            {step !== "mfa" && step !== "new-password" ? (
              <label className="block">
                <span className="text-[11px] font-medium tracking-wide text-sand/90">
                  Email
                </span>
                <input
                  autoFocus={step === "login" || step === "forgot"}
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={FIELD}
                  placeholder="operator@4401.earth"
                />
              </label>
            ) : null}
            {step === "login" ? (
              <label className="block">
                <span className="text-[11px] font-medium tracking-wide text-sand/90">
                  Password
                </span>
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required={!devAllowed}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={FIELD}
                />
              </label>
            ) : null}
            {step === "confirm" || step === "mfa" ? (
              <label className="block">
                <span className="text-[11px] font-medium tracking-wide text-sand/90">
                  {step === "mfa" ? "Authenticator code" : "Reset code"}
                </span>
                <input
                  autoFocus
                  type="text"
                  name="code"
                  inputMode="numeric"
                  autoComplete={step === "mfa" ? "one-time-code" : "one-time-code"}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className={FIELD}
                />
              </label>
            ) : null}
            {step === "confirm" || step === "new-password" ? (
              <label className="block">
                <span className="text-[11px] font-medium tracking-wide text-sand/90">
                  New password
                </span>
                <input
                  autoFocus={step === "new-password"}
                  type="password"
                  name="new-password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className={FIELD}
                />
                <span className="mt-1.5 block text-[11px] text-calcite/55">
                  At least 12 characters, with upper, lower, number, and symbol.
                </span>
              </label>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-calcite text-[13px] font-semibold text-earth disabled:opacity-60"
            >
              {pending ? copy.pending : copy.action}
            </button>
            {step === "login" && cognito ? (
              <button
                type="button"
                className="block w-full text-center text-[12px] text-sand/90 hover:text-calcite"
                onClick={() => {
                  setMessage("");
                  setStep("forgot");
                }}
              >
                Forgot password?
              </button>
            ) : null}
            {step === "forgot" ? (
              <button
                type="button"
                className="block w-full text-center text-[12px] text-sand/90 hover:text-calcite"
                onClick={() => {
                  setMessage("");
                  setStep("login");
                }}
              >
                Back to sign in
              </button>
            ) : null}
            {step === "confirm" ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  className="block w-full text-center text-[12px] text-sand/90 hover:text-calcite disabled:opacity-60"
                  onClick={() => {
                    void (async () => {
                      setPending(true);
                      setMessage("");
                      try {
                        await requestReset();
                      } catch {
                        setMessage("Could not reach MinRV");
                      } finally {
                        setPending(false);
                      }
                    })();
                  }}
                >
                  Resend code
                </button>
                <button
                  type="button"
                  className="block w-full text-center text-[12px] text-sand/90 hover:text-calcite"
                  onClick={() => {
                    setMessage("");
                    setStep("login");
                  }}
                >
                  Back to sign in
                </button>
              </>
            ) : null}
            {step === "new-password" || step === "mfa" ? (
              <button
                type="button"
                className="block w-full text-center text-[12px] text-sand/90 hover:text-calcite"
                onClick={() => {
                  setChallengeSession("");
                  setNewPassword("");
                  setCode("");
                  setMessage("");
                  setStep("login");
                }}
              >
                Back to sign in
              </button>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}

function copyFor(step: Step) {
  switch (step) {
    case "forgot":
      return {
        title: "Reset password",
        body: "Enter the email on your MinRV account. If it exists, we will send a reset code.",
        action: "Send reset code",
        pending: "Sending…",
      };
    case "confirm":
      return {
        title: "Check your email",
        body: "Enter the code from your email and choose a new password.",
        action: "Update password",
        pending: "Updating…",
      };
    case "new-password":
      return {
        title: "Set a new password",
        body: "Your account requires a new password before you can continue.",
        action: "Continue",
        pending: "Saving…",
      };
    case "mfa":
      return {
        title: "Authenticator",
        body: "Enter the code from your authenticator app.",
        action: "Verify",
        pending: "Verifying…",
      };
    default:
      return {
        title: "Log in",
        body: "Sign in with your MinRV account to continue.",
        action: "Enter MinRV",
        pending: "Entering…",
      };
  }
}

async function postJson<T>(path: string, body: Record<string, string | undefined>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}
