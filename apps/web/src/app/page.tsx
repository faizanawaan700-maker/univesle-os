"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { BusinessOperations } from "./business-operations";
import { getApiBaseUrl } from "./api-base";
import { SpatialAppShell } from "@/components/SpatialAppShell";
import { BusinessIntelligenceWorkspace } from "@/components/BusinessIntelligenceWorkspace";

type Organization = {
  id: string;
  name: string;
  role: string;
};

type User = {
  id: string;
  email: string;
  name: string;
  organizations: Organization[];
};

type CurrentOrganization = {
  id: string;
  name: string;
  role: string;
  permissions: string[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // A stalled API must not leave the UI in its loading state forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      signal: init?.signal ?? controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (cause) {
    if ((cause as Error)?.name === "AbortError") {
      throw new Error("The API did not respond in time. Check that the API is running.");
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message)
      ? body.message.join(" ")
      : body?.message;
    const error = new Error(message || `Request failed (${response.status}).`);
    Object.assign(error, { status: response.status });
    throw error;
  }
   
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<CurrentOrganization | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<"login" | "register">("register");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const requestInFlightRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    request<User>("/auth/me")
      .then((profile) => {
        if (!active) return;
        setUser(profile);
        setSelectedId(profile.organizations[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (!active) return;
        // Treat 401 from /auth/me as normal logged-out state — do not show error.
        if (cause instanceof Error && (cause as Error & { status?: number }).status === 401) {
          // user remains null; this is the expected logged-out presentation
        } else {
          setError(
            cause instanceof TypeError
              ? "The API is unavailable. Start the API and configure PostgreSQL."
              : errorMessage(cause),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user || !selectedId) {
      setOrganization(null);
      return;
    }

    let active = true;
    setOrganization(null);
    request<CurrentOrganization>("/organizations/current", {
      headers: { "X-Organization-Id": selectedId },
    })
      .then((current) => {
        if (active) setOrganization(current);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
  }, [selectedId, user]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const values = new FormData(event.currentTarget);
    let organizationName = String(values.get("organizationName") ?? "").trim();
    // Reject empty organizationName client-side in register mode
    if (mode === "register" && organizationName === "") {
      setError("Organization name is required.");
      requestInFlightRef.current = false;
      setBusy(false);
      return;
    }
    const payload = {
      email: String(values.get("email") ?? ""),
      password: String(values.get("password") ?? ""),
      name: String(values.get("name") ?? ""),
      organizationName: mode === "register" ? organizationName : "",
    };;

    try {
      await request<{ user: User }>(
        `/auth/${mode === "register" ? "register" : "login"}`,
        {
          method: "POST",
          body: JSON.stringify(
            mode === "register"
              ? payload
              : { email: payload.email, password: payload.password },
          ),
        },
      );
      const profile = await request<User>("/auth/me");
      setUser(profile);
      setSelectedId(profile.organizations[0]?.id ?? "");
      setNotice(mode === "register" ? "Your business workspace is ready." : "Welcome back.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      requestInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const created = await request<Organization & { createdAt: string }>(
        "/organizations",
        {
          method: "POST",
          body: JSON.stringify({ name: String(values.get("newOrganization") ?? "") }),
        },
      );
      const refreshed = await request<User>("/auth/me");
      setUser(refreshed);
      setSelectedId(created.id);
      setNotice("Organization created.");
      form.reset();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      requestInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function signOut() {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setBusy(true);
    setError("");
    try {
      await request<void>("/auth/logout", { method: "POST" });
      setUser(null);
      setOrganization(null);
      setSelectedId("");
      setNotice("You have signed out.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      requestInFlightRef.current = false;
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="loading-screen" aria-live="polite">
        <span className="brand-mark">U</span>
        <p>Connecting to your workspace…</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-layout">
        <section className="intro-panel">
          <a className="brand" href="/" aria-label="Universal Business OS home">
            <span className="brand-mark">U</span>
            <span>UNIVERSAL <b>BUSINESS OS</b></span>
          </a>
          <div className="intro-copy">
            <p className="eyebrow">ONE CLEAR VIEW OF YOUR BUSINESS</p>
            <h1>Run your business with confidence.</h1>
            <p className="intro-description">
              A secure foundation for your teams, locations, and the work that
              keeps your business moving.
            </p>
          </div>
          <p className="intro-footnote">Private by design · Built to grow with you</p>
        </section>

        <section className="form-panel">
          <div className="form-card">
            <div className="mobile-brand">
              <span className="brand-mark">U</span>
              <span>UNIVERSAL <b>BUSINESS OS</b></span>
            </div>
            <p className="eyebrow">{mode === "register" ? "GET STARTED" : "WELCOME BACK"}</p>
            <h2>{mode === "register" ? "Create your workspace" : "Sign in to your account"}</h2>
            <p className="form-subtitle">
              {mode === "register"
                ? "Set up your account and first organization."
                : "Use your account credentials to continue."}
            </p>
            {error && <div className="alert error" role="alert">{error}</div>}
            {notice && <div className="alert success" role="status">{notice}</div>}
            <form onSubmit={submitAuth} className="form-stack">
              {mode === "register" && (
                <>
                  <label>
                    Your name
                    <input name="name" autoComplete="name" required maxLength={120} />
                  </label>
                  <label>
                    Business or organization
                    <input name="organizationName" autoComplete="organization" required maxLength={160} />
                  </label>
                </>
              )}
              <label>
                Work email
                <input name="email" type="email" autoComplete="email" required maxLength={320} />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  required
                  minLength={mode === "register" ? 12 : undefined}
                  maxLength={128}
                />
                {mode === "register" && <span className="field-hint">Use at least 12 characters.</span>}
              </label>
              <button className="primary-button" disabled={busy} type="submit">
                {busy ? "Please wait…" : mode === "register" ? "Create workspace" : "Sign in"}
                {!busy && <span aria-hidden="true">→</span>}
              </button>
            </form>
            <p className="form-switch">
              {mode === "register" ? "Already have an account?" : "New to Universal Business OS?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setError("");
                  setNotice("");
                }}
              >
                {mode === "register" ? "Sign in" : "Create an account"}
              </button>
            </p>
            <p className="security-note"><span aria-hidden="true">◈</span> Your account is protected with secure sessions.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <SpatialAppShell
      user={{ name: user.name, email: user.email }}
      onSignOut={signOut}
    >
      <div style={{ padding: "var(--space-6)" }}>
        {organization ? (
          <>
            {error && <div className="alert error" role="alert">{error}</div>}
            {notice && <div className="alert success" role="status">{notice}</div>}
            <BusinessIntelligenceWorkspace>
              <BusinessOperations
                organizationId={organization.id}
                permissions={organization.permissions ?? []}
              />
            </BusinessIntelligenceWorkspace>
          </>
        ) : (
          <section className="business-section" aria-live="polite">
            <p className="business-state">Loading organization access…</p>
          </section>
        )}
      </div>
    </SpatialAppShell>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong. Please try again.";
}
