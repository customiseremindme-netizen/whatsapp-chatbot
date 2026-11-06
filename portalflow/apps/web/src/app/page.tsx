import Link from "next/link";
import { ArrowRight, Layers, ShieldCheck, Users } from "lucide-react";
import { Button, Card } from "@portalflow/ui";
import { BrandName } from "../components/branding";
export default function Home() {
  return (
    <>
      <header className="mx-auto flex max-w-6xl items-center justify-between p-6">
        <Link className="flex items-center gap-2 text-xl font-bold" href="/">
          <Layers className="text-blue-600" />
          <BrandName />
        </Link>
        <nav className="flex gap-3">
          <Button asChild variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Create workspace</Link>
          </Button>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-3xl">
          <p className="mb-6 text-sm font-semibold uppercase tracking-widest text-blue-600">
            Your business. Connected.
          </p>
          <h1 className="text-5xl font-bold leading-tight tracking-tight sm:text-7xl">
            A better home for your customer conversations.
          </h1>
          <p className="my-8 max-w-xl text-lg leading-relaxed text-slate-500">
            Bring your team into one secure workspace. PortalFlow is building
            the foundations for thoughtful WhatsApp automation.
          </p>
          <Button asChild>
            <Link href="/register">
              Start your workspace <ArrowRight size={18} />
            </Link>
          </Button>
          <p className="mt-4 text-sm text-slate-500">
            Development release · Workspaces and mock inbox available
          </p>
        </div>
        <div className="mt-20 grid gap-6 md:grid-cols-3">
          {[
            [
              ShieldCheck,
              "Private by design",
              "Membership checks protect every workspace request.",
            ],
            [
              Users,
              "A place for your team",
              "Invite colleagues and set the right level of access.",
            ],
            [
              Layers,
              "Ready for the next chapter",
              "Build a workflow, test it through the mock provider and capture leads in your shared inbox.",
            ],
          ].map(([Icon, title, body]) => {
            const Glyph = Icon as typeof Layers;
            return (
              <Card key={String(title)}>
                <Glyph className="mb-5 text-blue-600" />
                <h2 className="font-semibold">{String(title)}</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {String(body)}
                </p>
              </Card>
            );
          })}
        </div>
      </main>
      <footer className="mx-auto max-w-6xl border-t border-slate-200 p-6 text-sm text-slate-500">
        PortalFlow · Independent software. No Meta partnership claimed.
      </footer>
    </>
  );
}
