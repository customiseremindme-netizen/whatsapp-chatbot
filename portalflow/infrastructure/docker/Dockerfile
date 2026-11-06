# syntax=docker/dockerfile:1
FROM node:24-bookworm AS build
WORKDIR /app
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@11.25.0
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm install --frozen-lockfile
ENV DATABASE_URL=postgresql://unused:unused@localhost:5432/unused
ENV API_URL=http://api:4000
ARG NEXT_PUBLIC_API_ORIGIN=http://localhost:4000
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN
RUN pnpm --filter @portalflow/database generate && pnpm build
FROM node:24-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
RUN ln -s /usr/local/lib/node_modules/pnpm/bin/pnpm.mjs /usr/local/bin/pnpm
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000 4000
CMD ["node", "apps/api/dist/main.js"]
