# PostScope Internal Deployment Guide

This guide is for teams that want to deploy PostScope locally for internal users, including offline or air-gapped environments.

PostScope can run as a single Docker image. The image contains the production web bundle, the small Node server used for runtime configuration and optional shared collection storage, and the installed Node dependencies. After the image is pulled or loaded on a host, it can run without internet access.

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
- A Node HTTP server started by `npm run start`, which serves `dist/`, returns `/api/config`, and optionally stores shared collection history in `/app/data/library`.

Core collection parsing and auditing still run in the user's browser. The server only handles app configuration, static files, and optional shared library storage.

## Runtime Configuration

Set these variables on the container or host process:

| Variable | Default | Values | Purpose |
|----------|---------|--------|---------|
| `PORT` | `3010` | Any available TCP port inside the container/process | Port the Node server listens on. |
| `APP_VERSION` | Package version or image build arg | Release or build identifier, for example `0.0.2` or `2026.06.11-security.1` | Exposed by `/api/config` so operators can confirm which build is running. |
| `LOGGING_MODE` | `off` | `off`, `hybrid`, `on` | Controls whether uploaded collections are stored in app filesystem storage. |
| `PUBLIC_LANDING_PAGE` | `false` | `true`, `false`, `yes`, `no`, `1`, `0`, `on`, `off` | Shows marketing landing page at `/` when true; for internal deployments, keep false so users land on the analyzer. |

Logging modes:

| Mode | Behavior | Recommended use |
|------|----------|-----------------|
| `off` | Incognito only. Collections are analyzed in the browser and are not saved to the app server. | Public demos, privacy-first internal use, offline kiosks without shared history. |
| `hybrid` | Users can choose incognito or save to shared app history. | Internal team deployments where users should decide per collection. |
| `on` | Every imported collection is saved to shared app history. | Controlled internal environments where central history is required and users understand the policy. |

## Option 1: Run From Source

Use this for development or a simple internal host that already has Node.js.

Prerequisites:

- Node.js 18+ or 20+.
- npm.

Steps:

```bash
npm install
npm run build
LOGGING_MODE=hybrid PUBLIC_LANDING_PAGE=false PORT=3010 npm run start
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
docker build -t postscope:0.0.1 .
```

Or build with an explicit version label:

```bash
docker build \
  --build-arg APP_VERSION=0.0.1 \
  -t postscope:0.0.1 .
```

Run without shared server-side history:

```bash
docker run --rm \
  --name postscope \
  -p 3010:3010 \
  -e LOGGING_MODE=off \
  -e PUBLIC_LANDING_PAGE=false \
  postscope:0.0.1
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
  postscope:0.0.1
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
  postscope:0.0.1
```

Use an env file if operators prefer to keep runtime settings outside the command:

```bash
docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  --env-file postscope.env \
  -v postscope-data:/app/data \
  postscope:0.0.1
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
POSTSCOPE_VERSION=0.0.1
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
docker build -t postscope:0.0.1 .
```

Export the image to a portable tar file:

```bash
docker save postscope:0.0.1 -o postscope-0.0.1.tar
```

Transfer `postscope-0.0.1.tar` to the offline host, then load it:

```bash
docker load -i postscope-0.0.1.tar
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
  postscope:0.0.1
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
  --build-arg APP_VERSION=0.0.2 \
  -t postscope:0.0.2 .
docker save postscope:0.0.2 -o postscope-0.0.2.tar
sha256sum postscope-0.0.2.tar > postscope-0.0.2.tar.sha256
```

Windows PowerShell checksum:

```powershell
Get-FileHash .\postscope-0.0.2.tar -Algorithm SHA256
```

Offline host:

```bash
sha256sum -c postscope-0.0.2.tar.sha256
docker load -i postscope-0.0.2.tar
docker stop postscope
docker rm postscope
docker run -d \
  --name postscope \
  --restart unless-stopped \
  -p 3010:3010 \
  -e APP_VERSION=0.0.2 \
  -e LOGGING_MODE=hybrid \
  -e PUBLIC_LANDING_PAGE=false \
  -v postscope-data:/app/data \
  postscope:0.0.2
curl http://localhost:3010/api/config
```

Expected version signal:

```json
{"appVersion":"0.0.2","loggingMode":"hybrid","publicLandingPage":false}
```

Compose update flow:

1. Load the new image tar on the offline host.
2. Change `POSTSCOPE_VERSION` in `postscope.env`.
3. Run `docker compose --env-file postscope.env up -d`.

Example:

```bash
docker load -i postscope-0.0.2.tar
sed -i 's/POSTSCOPE_VERSION=0.0.1/POSTSCOPE_VERSION=0.0.2/' postscope.env
docker compose --env-file postscope.env up -d
curl http://localhost:3010/api/config
```

If the offline host cannot run Docker, ship a full source release only when it also includes a prebuilt `dist/` directory and an offline dependency cache or vendored `node_modules` suitable for the target OS and CPU architecture. The Docker image path is safer because it packages the runtime and dependencies together.

## Pulling From An Internal Registry

If your organization has an internal registry, build and push the image while connected to that registry:

```bash
docker tag postscope:0.0.1 registry.internal.example.com/postscope:0.0.1
docker push registry.internal.example.com/postscope:0.0.1
```

Then internal hosts can pull once:

```bash
docker pull registry.internal.example.com/postscope:0.0.1
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

Treat this backup as sensitive if users save real Postman collections. Collections may contain tokens, internal URLs, or credentials.

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
  postscope:0.0.1
```

Proxy `https://postscope.internal.example.com` to `http://127.0.0.1:3010`.

If shared history is enabled, allow request bodies above the app storage limit of 15 MB so reverse proxy limits do not reject uploads before the app can validate them.

## Verification

Check the server configuration endpoint:

```bash
curl http://localhost:3010/api/config
```

Expected response for the recommended internal mode:

```json
{"appVersion":"0.0.1","loggingMode":"hybrid","publicLandingPage":false}
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
docker build -t postscope:0.0.2 .
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
  postscope:0.0.2
```

The image is immutable; shared history lives in the mounted volume.

## Security Notes

- Keep `LOGGING_MODE=off` when collections should never be written to the server.
- Use `hybrid` only when users can make an informed choice about saving collections to shared app storage.
- Use `on` only in an internal environment with clear policy, access control, and backups.
- Do not bake `.env` files or `data/` into images. `.dockerignore` already excludes them.
- Put authentication, TLS, and organization-specific access control at the reverse proxy or platform layer.
- Review saved `data/library/*.json` files as sensitive data.

## Current Packaging Trade-Off

The runtime image includes the Node dependencies needed to run the TypeScript server entrypoint with the existing `npm run start` script. This favors reliability and a straightforward single-image deployment. A future optimization could compile the server into plain JavaScript and prune development-only dependencies to reduce image size.
