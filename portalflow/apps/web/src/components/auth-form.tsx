"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { registerSchema, loginSchema, emailSchema } from "@portalflow/shared";
import { Button, Input, Alert, Card } from "@portalflow/ui";
import { Layers } from "lucide-react";
import { post } from "../lib/api";
import { BrandName } from "./branding";
type Mode = "login" | "register" | "forgot-password";
const formSchema = z.object({
  email: emailSchema,
  password: z.string(),
  name: z.string(),
  workspace: z.string(),
});
type Values = z.infer<typeof formSchema>;
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "", name: "", workspace: "" },
  });
  async function submit(values: Values) {
    setError("");
    try {
      if (mode === "forgot-password") {
        await post("/auth/forgot-password", { email: values.email });
        setNotice(
          "If your account is eligible, check your email for a reset link.",
        );
        return;
      }
      const input =
        mode === "register"
          ? registerSchema.parse(values)
          : loginSchema.parse({
              email: values.email,
              password: values.password,
            });
      await post(`/auth/${mode}`, input);
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(". ")
          : e instanceof Error
            ? e.message
            : "Request failed",
      );
    }
  }
  const title =
    mode === "register"
      ? "Create your workspace"
      : mode === "login"
        ? "Welcome back"
        : "Reset your password";
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-slate-950 p-14 text-white lg:flex">
        <Link href="/" className="flex gap-2 text-2xl font-bold">
          <Layers />
          <BrandName />
        </Link>
        <div>
          <p className="mb-5 text-blue-300">A little more connected.</p>
          <h1 className="text-5xl font-semibold leading-tight">
            Great customer relationships start with a great team.
          </h1>
          <p className="mt-6 text-slate-400">
            One workspace. Clear roles. A foundation you can trust.
          </p>
        </div>
        <p className="text-sm text-slate-400">
          Account foundation · Development release
        </p>
      </section>
      <section className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-0 shadow-none">
          <Link href="/" className="text-sm text-blue-600">
            ← <BrandName />
          </Link>
          <h2 className="mb-2 mt-8 text-3xl font-bold">{title}</h2>
          <p className="mb-8 text-sm text-slate-500">
            {mode === "register"
              ? "Start with your business details."
              : "Use your business email to continue."}
          </p>
          <form onSubmit={handleSubmit(submit)} className="space-y-5">
            {mode === "register" && (
              <>
                <div>
                  <label htmlFor="name">Your name</label>
                  <Input
                    id="name"
                    autoComplete="name"
                    required
                    {...register("name")}
                  />
                </div>
                <div>
                  <label htmlFor="workspace">Business name</label>
                  <Input
                    id="workspace"
                    autoComplete="organization"
                    required
                    {...register("workspace")}
                  />
                </div>
              </>
            )}
            <div>
              <label htmlFor="email">Email address</label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                {...register("email")}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.email.message}
                </p>
              )}
            </div>
            {mode !== "forgot-password" && (
              <div>
                <label htmlFor="password">Password</label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  minLength={mode === "register" ? 12 : 1}
                  maxLength={128}
                  required
                  {...register("password")}
                />
                {mode === "register" && (
                  <p className="mt-1 text-xs text-slate-500">
                    At least 12 characters.
                  </p>
                )}
              </div>
            )}
            {error && <Alert>{error}</Alert>}
            {notice && (
              <p role="status" className="text-sm text-green-700">
                {notice}
              </p>
            )}
            <Button className="w-full" disabled={isSubmitting}>
              {isSubmitting
                ? "Please wait…"
                : mode === "register"
                  ? "Create workspace"
                  : mode === "login"
                    ? "Sign in"
                    : "Send reset link"}
            </Button>
          </form>
          <div className="mt-6 flex justify-between text-sm text-blue-600">
            <Link href={mode === "register" ? "/login" : "/register"}>
              {mode === "register"
                ? "Already have an account?"
                : "Create an account"}
            </Link>
            {mode === "login" && (
              <Link href="/forgot-password">Forgot password?</Link>
            )}
          </div>
        </Card>
      </section>
    </main>
  );
}
