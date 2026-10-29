# PostScope Internal Deployment Guide

This guide is for teams that want to deploy PostScope locally for internal users, including offline or air-gapped environments.

PostScope can run as a single Docker image. The image contains the production web bundle and the small Node server (compiled to one JavaScript file) used for runtime configuration and optional shared collection storage. It ships no `node_modules` and no TypeScript sources. After the image is pulled or loaded on a host, it can run without internet access.

## Implementation Plan

The deployment work in this repository is scoped to these actions and configuration changes:

| Area | Action | Result |
|------|--------|--------|
| Docker packaging | Add `Dockerfile` | Builds the React app, copies the Node server, exposes port `3010`, and declares `/app/data` for persistent app storage. |
| Build hygiene | Add `.dockerignore` | Keeps local `node_modules`, `dist`, `.env`, and `data/` out of Docker build context so local secrets and saved collections are not baked into the image. |
| Offline readiness | Vendor Elms Sans font assets | The app serves fonts from `public/fonts`, so the browser does not need Google Fonts during offline use. |
| Runtime configuration | Use environment variables | `LOGGING_MODE`, `PUBLIC_LANDING_PAGE`, `PORT`, and `APP_VERSION` configure and identify a deployed build. |
| Repeatable operations | Add `compose.yaml` | Keeps image tag, environment, port binding, restart policy, and persistent volume in one file. |
| Documentation | Add this guide and README link | Gives operators source, Docker, offline transfer, persistence, update, upgrade, and verification steps. |

## Deployment Model

The app has two runtime parts:

- The browser UI, built by Vite into `dist/`.
- A Node HTTP server (`node dist-node/server.js` in the image, `npm run start` from source), which serves `dist/`, returns `/api/config`, and optionally stores shared collection history in `/app/data/library`.

Core collection parsing and auditing still run in the user's browser. The server only handles app configuration, static files, and optional shared library storage.

## Runtime Configuration

Set these variables on the container or host process:

| Variable | Default | Values | Purpose |
|----------|---------|--------|---------|
| `PORT` | `3010` | Any available TCP port inside the container/process | Port the Node server listens on. |
| `APP_VERSION` | Package version or image build arg | Release or build identifier, for example `0.1.25` or `2026.06.11-security.1` | Exposed by `/api/config` so operators can confirm which build is running. |
| `LOGGING_MODE` | `off` | `off`, `hybrid`, `on` | Controls whether uploaded collections are stored in app filesystem storage. |
| `PUBLIC_LANDING_PAGE` | `false` | `true`, `false`, `yes`, `no`, `1`, `0`, `on`, `off` | Shows marketing landing page at `/` when true; for internal deployments, keep false so users land on the analyzer. |
| `SHOW_GITHUB_LINK` | `true` | `true`, `false`, `yes`, `no`, `1`, `0`, `on`, `off` | Shows or hides the analyzer sidebar GitHub link. Set to `false` for closed internal networks. |
| `SHOW_FEEDBACK_LINK` | `true` | `true`, `false`, `yes`, `no`, `1`, `0`, `on`, `off` | Shows or hides the analyzer sidebar feedback link. Set to `false` for closed internal networks. |
| `FEEDBACK_URL` | GitHub issue form | Absolute URL | External form opened by the analyzer sidebar feedback link. |
| `AUDIT_RULE_PACKS` | `auto` | `auto`, `none`, or a list of `iam-am`, `iam-iga`, `iam-pam`, `iam-platform` (prefix a pack with `-` to switch it off) | Rule packs for every browser. `auto` switches the identity packs on when a collection shows identity signals (OAuth, OIDC, SCIM, SAML, vault or admin APIs). The core pack always runs. Invalid entries are ignored with a warning. |
| `SCORE_WEIGHTS` | `critical=20,warning=8,info=2` | Any subset of `critical=N,warning=N,info=N`, each 0 to 100 | Points deducted per finding severity in the score (scoring model v2). Sent to every browser through `/api/config`; the CLI uses `--weights`. Invalid entries are ignored with a warning. |
| `LIBRARY_ENCRYPTION_KEY` | unset | 32 random bytes as 64 hex characters or base64 | Encrypts every stored collection with AES-256-GCM. See [Encrypting the library](#encrypting-the-library). |
| `LIBRARY_ENCRYPTION_KEY_FILE` | unset | Path to a file holding the key | Same, but reads the key from a file such as a Docker or Kubernetes secret. Takes precedence over `LIBRARY_ENCRYPTION_KEY`. |
| `LIBRARY_ENCRYPTION_KEY_PREVIOUS`, `LIBRARY_ENCRYPTION_KEY_PREVIOUS_FILE` | unset | Comma separated keys (file: one per line) | Older keys that may still decrypt records while you rotate. |
| `LIBRARY_AUDIT_LOG` | `true` | `true`, `false` | Appends one JSON line per library save, open and removal to `DATA_DIR/audit/library-YYYY-MM.jsonl`. |
| `TRUSTED_USER_HEADER` | unset | A header name such as `X-Forwarded-User` or `X-Auth-Request-Email` | Records the signed-in user set by your SSO proxy as `savedBy` and in the audit log. Honored only when `TRUST_PROXY=true`. |
| `TRUST_PROXY` | `false` | `true`, `false` | Trust `X-Forwarded-For` / `X-Forwarded-Host` from a reverse proxy. Leave `false` when clients connect directly. |
| `TRUST_PROXY_HOPS` | `1` | Integer 1 to 10 | Number of trusted proxies in front of PostScope (only with `TRUST_PROXY=true`). The client IP is the entry that many positions from the right of `X-Forwarded-For`; entries further left are client-controlled and ignored. Use `2` for a CDN plus a load balancer. |
| `HEALTH_EXPOSE_VERSION` | `true` | `true`, `false` | When `false`, the unauthenticated `/api/health` endpoint omits `version`. `/api/config` is behind Basic auth when it is enabled. |

Logging modes:

| Mode | Behavior | Recommended use |
|------|----------|-----------------|
| `off` | Incognito only. Collections are analyzed in the browser and are not saved to the app server. | Public demos, privacy-first internal use, offline kiosks without shared history. |
| `hybrid` | Users can choose incognito or save to shared app history. | Internal team deployments where users should decide per collection. |
| `on` | Every imported collection is saved to shared app history. | Controlled internal environments where central history is required and users understand the policy. |

## Option 1: Run From Source

Use this for development or a simple internal host that already has Node.js.

Prerequisites:

- Node.js 22 or newer (24 is the current LTS line used by the container image).
- npm.

Steps:

```bash
npm install
npm run build
LOGGING_MODE=hybrid PUBLIC_LANDING_PAGE=false PORT=3010 npm run start
```

To run the compiled server (one JavaScript file that needs no dependencies, the same one the Docker image runs), build it once and start it with plain `node`:

```bash
npm run build && npm run build:node
LOGGING_MODE=hybrid PORT=3010 npm run start:node
```

On Windows PowerShell:

```powershell
$env:LOGGING_MODE = "hybrid"
$env:PUBLIC_LANDING_PAGE = "false"
$env:PORT = "3010"
npm run start
```

Open `http://localhost:3010`.

## Option 2: Build And Run One Docker Image

Build the image:

```bash
docker build -t postscope:<version> .
```

Or build with an explicit version label:

```bash
docker build \
  --build-arg APP_VERSION=<version> \
  -t postscope:<version> .
```

Run without shared server-side history:

```bash
docker run --rm \
  --name postscope \
  -p 3010:3010 \
  -e LOGGING_MODE=off \
  -e PUBLIC_LANDING_PAGE=false \
  postscope:<version>
```

Run for an internal team with optional shared history:

```bash
docker volume create postscope-data

docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  -e LOGGING_MODE=hybrid \
  -e PUBLIC_LANDING_PAGE=false \
  -v postscope-data:/app/data \
  postscope:<version>
```

Run with forced shared history:

```bash
docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  -e LOGGING_MODE=on \
  -e PUBLIC_LANDING_PAGE=false \
  -v postscope-data:/app/data \
  postscope:<version>
```

Use an env file if operators prefer to keep runtime settings outside the command:

```bash
docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  --env-file postscope.env \
  -v postscope-data:/app/data \
  postscope:<version>
```

Example `postscope.env`:

```env
PORT=3010
LOGGING_MODE=hybrid
PUBLIC_LANDING_PAGE=false
```

Do not put secrets in this file. The stock app does not require API keys.

## Option 3: Run With Docker Compose

`compose.yaml` is included for repeatable local operations. It uses a named volume for shared history and binds the app to `127.0.0.1` by default.

Create a local Compose env file:

```env
POSTSCOPE_VERSION=<version>
POSTSCOPE_HOST=127.0.0.1
POSTSCOPE_PORT=3010
LOGGING_MODE=hybrid
PUBLIC_LANDING_PAGE=false
```

Build and start:

```bash
docker compose --env-file postscope.env up -d --build
```

Run from an image that was already loaded on the host:

```bash
docker compose --env-file postscope.env up -d
```

## Offline And Air-Gapped Shipping

Yes, PostScope can be shipped as a single offline-runnable Docker image.

Build the image on a connected machine:

```bash
docker build -t postscope:<version> .
```

Export the image to a portable tar file:

```bash
docker save postscope:<version> -o postscope-<version>.tar
```

Transfer `postscope-<version>.tar` to the offline host, then load it:

```bash
docker load -i postscope-<version>.tar
```

Run it offline:

```bash
docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  -e LOGGING_MODE=hybrid \
  -e PUBLIC_LANDING_PAGE=false \
  -v postscope-data:/app/data \
  postscope:<version>
```

Artifacts needed on the offline host:

| Artifact | Required | Notes |
|----------|----------|-------|
| Docker image tar, or pre-pulled image | Yes | Contains the app bundle, server, and Node dependencies. |
| Runtime env file | Optional | Useful for repeatable operations; can be replaced by `-e` flags. |
| Docker volume or host-mounted `/app/data` | Optional | Required only if `LOGGING_MODE=hybrid` or `LOGGING_MODE=on` and shared history should survive container replacement. |
| Existing data backup | Optional | Only restore this if the team intentionally wants to carry shared collection history forward. |

The Docker build context intentionally excludes local `.env` files and `data/`, so private saved collections are not included in the image by accident.

Font files under `public/fonts` are part of the app bundle and are copied into the image. Browsers load them from the PostScope host, not from Google Fonts.

## Keeping Offline Deployments Up To Date

For hosts that must stay offline, do not update by running `git pull`, `npm install`, or `docker pull` on the offline host. Use a connected build or release machine, produce a complete artifact, then transfer that artifact into the offline environment.

Recommended update channel:

1. On a connected maintainer machine, pull the latest repository changes.
2. Build a new image with a unique immutable tag.
3. Export the image to a tar file.
4. Create a checksum file for transfer validation.
5. Move the tar and checksum to the offline host through your approved transfer process.
6. Verify the checksum on the offline host.
7. Load the image.
8. Replace the running container while reusing the same `/app/data` volume.
9. Check `/api/config` to confirm the running `appVersion`.

Connected build machine:

```bash
git pull
docker build \
  --build-arg APP_VERSION=<new-version> \
  -t postscope:<new-version> .
docker save postscope:<new-version> -o postscope-<new-version>.tar
sha256sum postscope-<new-version>.tar > postscope-<new-version>.tar.sha256
```

Windows PowerShell checksum:

```powershell
Get-FileHash .\postscope-<new-version>.tar -Algorithm SHA256
```

Offline host:

```bash
sha256sum -c postscope-<new-version>.tar.sha256
docker load -i postscope-<new-version>.tar
docker stop postscope
docker rm postscope
docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  -e APP_VERSION=<new-version> \
  -e LOGGING_MODE=hybrid \
  -e PUBLIC_LANDING_PAGE=false \
  -v postscope-data:/app/data \
  postscope:<new-version>
curl http://localhost:3010/api/config
```

Expected version signal:

```json
{"appVersion":"<new-version>","loggingMode":"hybrid","publicLandingPage":false}
```

Compose update flow:

1. Load the new image tar on the offline host.
2. Change `POSTSCOPE_VERSION` in `postscope.env`.
3. Run `docker compose --env-file postscope.env up -d`.

Example:

```bash
docker load -i postscope-<new-version>.tar
sed -i 's/POSTSCOPE_VERSION=<old-version>/POSTSCOPE_VERSION=<new-version>/' postscope.env
docker compose --env-file postscope.env up -d
curl http://localhost:3010/api/config
```

If the offline host cannot run Docker, ship a full source release only when it also includes a prebuilt `dist/` directory and an offline dependency cache or vendored `node_modules` suitable for the target OS and CPU architecture. The Docker image path is safer because it packages the runtime and dependencies together.

## Pulling From An Internal Registry

If your organization has an internal registry, build and push the image while connected to that registry:

```bash
docker tag postscope:<version> registry.internal.example.com/postscope:<version>
docker push registry.internal.example.com/postscope:<version>
```

Then internal hosts can pull once:

```bash
docker pull registry.internal.example.com/postscope:<version>
```

After the image has been pulled, runtime does not need external network access. Browser clients only need network access to the internal PostScope host.

## Persistence And Backups

Shared collection history is stored under:

```text
/app/data/library
```

For Docker deployments, mount a named volume:

```bash
-v postscope-data:/app/data
```

Without a volume, shared history disappears when the container is removed.

Back up a named Docker volume:

```bash
docker run --rm \
  -v postscope-data:/data \
  -v "$PWD:/backup" \
  alpine \
  tar czf /backup/postscope-data.tgz -C /data .
```

Restore to a fresh volume:

```bash
docker volume create postscope-data

docker run --rm \
  -v postscope-data:/data \
  -v "$PWD:/backup" \
  alpine \
  tar xzf /backup/postscope-data.tgz -C /data
```

Treat this backup as sensitive if users save real Postman collections. Collections may contain tokens, internal URLs, or credentials. With encryption on, backups of the volume hold ciphertext; keep the key in a different place than the backup.

### Encrypting the library

Set a key and every new collection is written as an AES-256-GCM envelope (`{ v, alg, kid, iv, tag, data }`) with a random IV per record. The record id is part of the authenticated data, so a record copied to another file name, or edited, is rejected and skipped instead of being shown. The deduplication hash becomes an HMAC under the key, so a listing cannot be used to test whether a known collection is stored.

```bash
# generate a key once and keep it in your secret store
openssl rand -hex 32
```

Pass it as `LIBRARY_ENCRYPTION_KEY`, or mount it as a secret and point `LIBRARY_ENCRYPTION_KEY_FILE` at the file (preferred, the value then stays out of `docker inspect` and process listings):

```bash
docker run -d --name postscope -p 127.0.0.1:3010:3010 \
  -e LOGGING_MODE=hybrid \
  -e LIBRARY_ENCRYPTION_KEY_FILE=/run/secrets/postscope_key \
  -v ./postscope_key:/run/secrets/postscope_key:ro \
  -v postscope-data:/app/data \
  postscope:<version>
```

| Situation | What happens |
|---|---|
| Key set, existing plaintext records | They stay readable. New saves are encrypted. Run the migration below to encrypt the old ones |
| Key set but invalid (not 32 bytes) | The server logs an error and refuses new saves; it never falls back to plaintext. Reads of plaintext records keep working |
| Key removed after records were encrypted | Encrypted records are skipped (and logged once) until the key is back |
| A record was modified | It fails authentication and is skipped |

Migrate existing records (run it while the server is stopped, or restart the server afterwards):

```bash
docker exec postscope node dist-node/library.js status
docker exec postscope node dist-node/library.js encrypt --dry-run
docker exec postscope node dist-node/library.js encrypt
# from a clone: npm run library:status, npm run library:encrypt
```

Each record is written to a temporary file, decrypted again and compared before it replaces the original, so an interrupted run never loses a collection.

**Rotating the key**

1. Generate a new key.
2. Set `LIBRARY_ENCRYPTION_KEY` to the new key and `LIBRARY_ENCRYPTION_KEY_PREVIOUS` to the old one, then restart. New saves use the new key; old records still open.
3. Run `library.js encrypt`. It rewrites every record sealed with the old key.
4. Run `library.js status`; when all records show the current key, remove `LIBRARY_ENCRYPTION_KEY_PREVIOUS` and destroy the old key.

Losing the key means losing the encrypted records. Back the key up separately from the data volume.

### Audit log

With the library enabled, every save, open and removal is appended to `DATA_DIR/audit/library-YYYY-MM.jsonl` (one file per month, mode `0600`):

```json
{"ts":"2026-10-15T08:30:00.000Z","action":"save","id":"...","name":"Payments API","user":"alice@example.com","ip":"203.0.113.9","requestId":"...","redactedCount":2}
```

Entries name the collection and the actor but never contain collection content. Listing the library is not logged. If a line cannot be written the request still succeeds and a warning is logged. Ship the folder to your log platform and keep it on storage the application cannot rewrite if you need tamper evidence. Disable with `LIBRARY_AUDIT_LOG=false`.

## Reverse Proxy And Internal Access

For internal users, place PostScope behind your normal reverse proxy if you need TLS, SSO, IP allowlists, or audit logging.

Recommended container bind when reverse proxying from the same host:

```bash
docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 127.0.0.1:3010:3010 \
  -e LOGGING_MODE=hybrid \
  -e PUBLIC_LANDING_PAGE=false \
  -v postscope-data:/app/data \
  postscope:<version>
```

Proxy `https://postscope.internal.example.com` to `http://127.0.0.1:3010`.

PostScope pages have their own addresses (`/security`, `/requests/<id>`, or the same below `/analyze` when `PUBLIC_LANDING_PAGE=true`), so the proxy must pass every path through to PostScope and must not rewrite or cache the HTML. Browser navigations to unknown paths receive the app shell; requests for missing scripts, styles and data still return 404.

### Single sign-on with a reverse proxy

Basic auth is one shared credential. To know who saved a collection, put an SSO-aware proxy in front, for example [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) with nginx, and let it pass the user through:

```nginx
location / {
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/sign_in;

    # Set from the proxy's own answer, so a client cannot supply it.
    auth_request_set $auth_email $upstream_http_x_auth_request_email;
    proxy_set_header X-Auth-Request-Email $auth_email;

    proxy_set_header X-Forwarded-For $remote_addr;   # one trusted hop
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:3010;
}
```

Then configure PostScope: `TRUST_PROXY=true`, `TRUST_PROXY_HOPS=1`, `TRUSTED_USER_HEADER=X-Auth-Request-Email`. The address is stored as `savedBy`, shown in the team library dialog and written to the audit log. The header is ignored when `TRUST_PROXY` is off, and PostScope must not be reachable around the proxy, otherwise anyone could send the header themselves.

When the proxy sits in front of PostScope, set `TRUST_PROXY=true` so rate limits and the failed sign-in lockout use the real client address, and set `TRUST_PROXY_HOPS` to the number of proxies you control (default `1`). Make sure the outermost trusted proxy appends the address it sees to `X-Forwarded-For` instead of passing a client-supplied value through unchanged. If PostScope is also reachable directly, bypassing the proxy, do not enable `TRUST_PROXY`.

If shared history is enabled, allow request bodies above the app storage limit of 15 MB so reverse proxy limits do not reject uploads before the app can validate them.

## Verification

Check the server configuration endpoint:

```bash
curl http://localhost:3010/api/config
```

Expected response for the recommended internal mode:

```json
{"appVersion":"<version>","loggingMode":"hybrid","publicLandingPage":false}
```

Then open:

```text
http://localhost:3010
```

Smoke-test the deployment:

1. Load the app.
2. Import a sample Postman collection.
3. Confirm Overview, Security, Hygiene, Repair, and Score views render.
4. If `LOGGING_MODE=hybrid` or `on`, verify shared history appears after choosing or forcing app storage.
5. Restart the container and confirm shared history remains when `/app/data` is mounted.

## Upgrade Procedure

Build, pull, or load the new image:

```bash
docker build -t postscope:<new-version> .
```

Replace the container while keeping the same volume:

```bash
docker stop postscope
docker rm postscope

docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  -e LOGGING_MODE=hybrid \
  -e PUBLIC_LANDING_PAGE=false \
  -v postscope-data:/app/data \
  postscope:<new-version>
```

The image is immutable; shared history lives in the mounted volume.

## Security Notes

- Keep `LOGGING_MODE=off` when collections should never be written to the server.
- Use `hybrid` only when users can make an informed choice about saving collections to shared app storage.
- Use `on` only in an internal environment with clear policy, access control, and backups.
- Do not bake `.env` files or `data/` into images. `.dockerignore` already excludes them.
- Put authentication, TLS, and organization-specific access control at the reverse proxy or platform layer.
- Review saved `data/library/*.json` files as sensitive data.

## Packaging

The image is built in stages. A build stage installs the dependencies, builds the web bundle (`dist/`) and compiles the server and the CLI with esbuild into `dist-node/server.js` and `dist-node/cli.js`. The runtime stage copies only `dist/`, `dist-node/` and `package.json`, so it contains no `node_modules`, no tsx and no TypeScript sources, and the process is started with `node dist-node/server.js`. Compared with the earlier image, which carried every npm dependency in order to run the TypeScript entry point, this removes the whole dependency tree from the runtime image and from its attack surface.

The compiled server reads `.env` files itself (`.env`, `.env.local`, `.env.production`, `.env.production.local`) instead of using Vite, so it works with no dependencies at all.

The same image also contains the CLI, for ad hoc scans on a host without Node.js:

```bash
docker run --rm -v "$PWD:/work" postscope:<version> node dist-node/cli.js scan /work/collections
```

See [CI.md](CI.md) for pipelines (GitHub Actions, GitLab CI, Azure DevOps) and the pre-commit hook.
