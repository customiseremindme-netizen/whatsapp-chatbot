# PortalFlow — start here

This is source code for a working local development application, **not the completed or publicly hosted SaaS**. Do not upload this ZIP into Hostinger public_html expecting it to run. It needs Node.js, PostgreSQL, Redis and a background worker.

## If you are handing it to Claude

1. Upload the complete ZIP.
2. Paste the contents of CLAUDE_PROMPT.md, or say: “Read CLAUDE_PROMPT.md in the ZIP and follow it.”
3. Claude should inspect the code, run tests, and continue the unfinished work listed in docs/CAPABILITY_MATRIX.md and docs/PRODUCT_REQUIREMENTS.md.
4. Ask for a working deployment and updated source ZIP, not screenshots alone.

If the chat cannot read ZIP archives, extract it on your device and provide CLAUDE_PROMPT.md and the relevant source files through Claude's project/repository tooling. An ordinary text chat cannot be assumed to have a running terminal or deployment access.

## Using the existing administration panel

Once a developer/agent starts the app using README.md:

- Open http://localhost:3000/login.
- Development admin: admin@portalflow.example.
- Development password: the SEED_PASSWORD set in .env; the supplied development example is LocalPortalFlow!2026.
- Choose **Platform admin** in the left menu, or open /admin.
- Business demo accounts: owner@lotus.example and owner@cedar.example, using the same development password.

These accounts are for local development only. Never expose them publicly. A production operator must create and verify their own account and use the documented admin bootstrap command.

Read docs/ADMIN_GUIDE.md for what each control actually does. Administrators can now assign plans and enforce contact, chatbot and team limits through Businesses → Manage plan access. These are manual access grants, not collected payments. Owners can inspect Plan and usage. The live WhatsApp connection, broadcasts, billing and many other requested capabilities are still unfinished.

## What is inside the ZIP

Source, lockfile, migrations, seed, tests, Docker/CI configuration, documentation, this guide and the Claude prompt. It excludes .env, databases, uploads, dependencies, compiled build folders, browser traces and Git history. Install/build instructions are in README.md. The project has not been pushed to GitHub or publicly deployed.
