# Deploying VulnTrade on local Kubernetes

> ⚠️ VulnTrade is **intentionally vulnerable**. Run it only on a local or isolated lab cluster.
> The chart exposes the same lab surface as docker compose: JDWP (5005), unauthenticated JMX
> (9090), Adminer, weak secrets and the CTF flags.

**Quick testing stays on docker compose** (`docker compose up` in the repo root). This folder is
for running the lab on a local cluster:

| Target | Cluster | How images get there |
|---|---|---|
| **minikube** (docker driver — e.g. on Docker Desktop) | kube context `minikube` | built with your Docker, then `minikube image load` |
| **OrbStack** | OrbStack's built-in Kubernetes, context `orbstack` | built on OrbStack's Docker engine; the cluster sees them directly |

```
deploy/
├── Makefile                 build · load · install · port-forward · status · reset
└── helm/vulntrade/
    ├── Chart.yaml           version / appVersion 1.0.0
    ├── values.yaml          defaults: published images 0xj4f/vulntrade-*:1.0.0
    ├── values-minikube.yaml local images, pullPolicy Never, storage class "standard"
    ├── values-orbstack.yaml local images, pullPolicy Never, default storage class
    ├── values-nodeport.yaml frontend :31080 and backend :31085 on the node IP (no port-forward)
    ├── files/               symlinks to ../../../../database, flags, log-shipper
    └── templates/           postgres · redis · adminer · backend · frontend · ingress ·
                             services.yaml (1.0.0 product services) · _logshipper.tpl
```

**1.0.0 services.** Besides `backend` (the platform), `frontend`, `postgres`, `redis` and `adminer`,
the chart deploys one trading gateway and one internals service per product from `values.yaml ->
services:` (`fx-gateway`, `fx-internals`, `equities-gateway`, `equities-internals`,
`crypto-gateway`, `crypto-internals`). They all run the backend image; `service:` picks the jar.
Internals wait for the platform to finish seeding and run as a single replica (one in-memory lock
per product). About 6 GiB of memory limits in total; give minikube at least 8 GiB.
See [docs/architecture.md](../docs/architecture.md).

## Prerequisites

- `kubectl`, `helm` 3, Docker (Docker Desktop or OrbStack)
- minikube: a running profile (`minikube start -p minikube --driver=docker --memory=10g --cpus=6`)
- OrbStack: Kubernetes enabled in OrbStack settings

## minikube

```bash
cd deploy
make minikube-up            # docker build → minikube image load → helm upgrade --install --wait
make port-forward           # http://localhost:3001 (frontend) · :8085 (API) · :8081 (Adminer)
```

The first boot takes a minute or two (JDK 11 + Spring Boot + database seeding); `--wait` returns
once every pod is ready. Sign in with `trader1` / `password`.

Upgrading a 0.6.x release? 1.0.0 changes the money model: run `make reset` first (fresh database).

Under load, prefer NodePorts over `kubectl port-forward`:

```bash
make install EXTRA_VALUES="-f helm/vulntrade/values-nodeport.yaml"
# frontend http://$(minikube -p minikube ip):31080   backend http://$(minikube -p minikube ip):31085
```

Already have images (e.g. from `docker compose build`)? Tag and load them instead of rebuilding:

```bash
docker tag vulntrade-backend:latest vulntrade-backend:local
docker tag vulntrade-frontend:latest vulntrade-frontend:local
make minikube-load install
```

## OrbStack

```bash
cd deploy
make orbstack-up            # builds on OrbStack's engine, installs into context "orbstack"
make port-forward KUBE_CONTEXT=orbstack
```

## Day-to-day

| Command | What it does |
|---|---|
| `make status` | pods, services and volumes |
| `make logs` | follow the backend log |
| `make install` | re-apply the chart (after changing values or images) |
| `make uninstall` | remove the release, keep the database volume |
| `make reset` | remove the release **and** the volumes (fresh seed next install) |
| `make lint` / `make template` | check or render the chart |

Variables: `KUBE_CONTEXT`, `NAMESPACE` (default `vulntrade`), `RELEASE`, `IMAGE_TAG` (default
`local`), `MINIKUBE_PROFILE`, `FRONTEND_PORT` / `BACKEND_PORT` / `ADMINER_PORT`.
The Makefile only talks to the contexts in `ALLOWED_CONTEXTS` (minikube, orbstack,
docker-desktop, kind-vulntrade) so a lab deploy can't land on a shared cluster by accident.

## Configuration notes

- **Service names are fixed** (`postgres`, `redis`, `backend`, `frontend`, `adminer`): the frontend's
  nginx proxies `/api`, `/ws`, `/ws-sockjs` and `/actuator` to `http://backend:8080`, the backend
  connects to `postgres` and `redis`. Install one release per namespace.
- **One backend replica.** Order matching is serialised with an in-memory lock; the chart uses a
  `Recreate` strategy.
- **Database seed.** `database/init.sql`, `seed_data.sql` and `flags.sql` run on an empty Postgres
  volume only. After pulling a new version, `make reset` for a fresh seed.
- **Ingress** (optional): `--set ingress.enabled=true --set ingress.className=<nginx|traefik>`
  (plus `ingress.host`). WebSockets go through the same route.
- **Published images**: install with the default `values.yaml` to pull `0xj4f/vulntrade-*:1.0.0`
  instead of building (amd64 images; on Apple Silicon build locally).
- **Log shipping** to S3 (Fluent Bit sidecar): `--set logShipper.enabled=true` plus the AWS values;
  see [../docs/log-shipping.md](../docs/log-shipping.md).
- **Security events** are written inside the backend pod at `/var/log/vulntrade/security.log`
  (`make logs`, or `kubectl -n vulntrade exec deploy/backend -- tail -f /var/log/vulntrade/security.log`).

## Troubleshooting

- `ErrImageNeverPull` — the image isn't on the node: `make build minikube-load` (minikube) or
  `make orbstack-build` (OrbStack).
- Backend restarting during the first boot — check `make logs`; the startup probe allows ~5 minutes.
- Port already in use for port-forward — `make port-forward FRONTEND_PORT=3011 BACKEND_PORT=8095`.
- Port-forward stops answering (`error creating error stream … Timeout`) — `kubectl port-forward` can wedge
  under bursts of concurrent connections (e.g. running the exploit matrix). For heavy testing use an
  ingress instead: with `minikube tunnel` running, `helm upgrade … --set ingress.enabled=true
  --set ingress.className=traefik` (or `nginx` with the minikube ingress addon) and browse
  `http://localhost/`.
