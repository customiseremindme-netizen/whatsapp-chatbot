# Deployment

This release validates accounts/workspaces and local mock text messaging. It is not the complete production WhatsApp SaaS. Use a staging environment before public exposure.

Local infrastructure: `docker compose up -d --wait`. Full local app: `docker compose -f docker-compose.yml -f docker-compose.app.yml up --build -d`. The application override explicitly uses development settings. For production, provide `.env.production.example` values through a secret store, run the image with `NODE_ENV=production` and `COOKIE_SECURE=true`, and use external PostgreSQL/Redis/SMTP. Do not use the local development override as a public production manifest.

The Dockerfile builds all workspaces and ships a shared runtime image, including tooling for migrations. It uses Node 24 Bookworm and runs as the `node` user. Further image slimming is pending. In a managed environment with an outbound proxy CA, build with `docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infrastructure/docker/Dockerfile -t portalflow:local .`; the certificate is mounted only during package-install steps.

Startup order: database and Redis healthy → `pnpm --filter @portalflow/database migrate` → API (`node apps/api/dist/main.js`) → worker (`node apps/worker/dist/main.js`) → web (`pnpm --filter @portalflow/web start`). For host development the root migration wrappers load `.env`; in a container the service environment supplies configuration directly.

Point a domain at the VPS/load balancer. Terminate HTTPS with Caddy, Nginx or a managed proxy. Forward the public web origin to port 3000; keep port 4000 private. Set WEB_ORIGIN to the exact external origin, with no trailing slash. The web image expects API_URL `http://api:4000` during build; adjust it for a different topology and rebuild. Use a vetted proxy-IP design before public launch; the current app does not trust forwarded headers. Proxy `/socket.io` with WebSocket upgrade headers to port 4000. Set NEXT_PUBLIC_API_ORIGIN to the external HTTPS origin at image build time (Docker build argument); the frontend CSP allows only that configured socket origin. The default remains localhost:4000 for local development.

Health: GET `/api/v1/health` checks PostgreSQL and passes through the Redis rate limiter. Worker failures emit structured event names and no message/token payloads. Inspect queue failure counts and pending/failed EmailOutbox records. Set up alerts for DB connections/disk, Redis memory, HTTP 5xx/503, outbox attempts >=5 and process restarts. Worker mail delivery is at-least-once. The periodic job retries each pending email up to five times; there is no operator retry UI yet.

Back up PostgreSQL daily to encrypted off-host storage:

```sh
docker compose exec -T postgres pg_dump -U portalflow -Fc portalflow > portalflow.dump
# Restore into a separately created staging database, never over live data without a recovery plan.
docker compose exec -T postgres pg_restore -U portalflow -d portalflow_restore < portalflow.dump
```

Test restore regularly; document RPO/RTO. Persist Redis AOF and PostgreSQL volumes. Apply migrations once per deployment before traffic. Test rollback against database compatibility; do not automatically reverse destructive schema changes.

DigitalOcean, AWS and Linux VPS deployments use this same image/topology. S3 storage, Meta webhook callback and verification, Razorpay and AI setup remain unimplemented and must not be advertised as available.


The full application Docker image has not yet been built/verified in this execution; infrastructure containers and host-mode builds/startup were verified.

The dedicated worker also runs `messaging-outbox` every second. Monitor QUEUED/FAILED messages and PENDING inbound events. `EMAIL_DELIVERY_ENABLED=false` disables only email delivery for integration test isolation; do not set it unintentionally in staging/production. Mock outgoing sends do not reach Meta. Live messaging remains unimplemented.

## Hostinger topology

For Hostinger Web Hosting plans, do not assume that an “unlimited” shared-hosting allowance includes PostgreSQL, Redis, Docker or persistent worker processes. Keep the domain/public marketing site there if desired and deploy this application to a Linux VPS using the topology above. An initial small deployment can start with 2 vCPU and 4 GB RAM, with monitoring and capacity adjustments for traffic. Point `app.<your-domain>` to the VPS after deployment validation and HTTPS setup. No public deployment has been performed; server and DNS setup remain external prerequisites.
