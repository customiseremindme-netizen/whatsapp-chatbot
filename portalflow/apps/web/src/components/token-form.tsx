"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, Input, Button, Alert } from "@portalflow/ui";
import { post } from "../lib/api";
export function TokenForm({
  mode,
}: {
  mode: "verify-email" | "reset-password" | "accept-invitation";
}) {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
    history.replaceState(null, "", location.pathname);
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(
        mode === "accept-invitation"
          ? "/tenants/invitations/accept"
          : `/auth/${mode}`,
        { token, ...(mode === "reset-password" ? { password } : {}) },
      );
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <Card>
        <h1 className="mb-6 text-2xl font-bold">
          {mode === "verify-email"
            ? "Verify your email"
            : mode === "reset-password"
              ? "Set a new password"
              : "Join your team"}
        </h1>
        {done ? (
          <p role="status">
            Done.{" "}
            <Link
              className="text-blue-600"
              href={mode === "reset-password" ? "/login" : "/dashboard"}
            >
              Continue →
            </Link>
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {mode === "accept-invitation" && (
              <p className="text-sm">
                Sign in with the invited email and verify it before accepting.
                Keep this page open while you{" "}
                <a
                  href="/login"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600"
                >
                  sign in
                </a>
                .
              </p>
            )}
            {mode === "reset-password" && (
              <>
                <label htmlFor="new-password">
                  New password (12+ characters)
                </label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </>
            )}
            {!token && (
              <Alert>
                This link is missing its token. Request a new email.
              </Alert>
            )}
            {error && <Alert>{error}</Alert>}
            <Button disabled={!token || busy}>
              {busy ? "Working…" : "Confirm"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
