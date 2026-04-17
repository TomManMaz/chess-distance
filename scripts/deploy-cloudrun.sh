#!/usr/bin/env bash
# Deploy the FastAPI backend to Google Cloud Run.
#
# Prereqs:
#   1. Install gcloud CLI → https://cloud.google.com/sdk/docs/install
#   2. `gcloud auth login`
#   3. `gcloud config set project <YOUR_PROJECT_ID>`
#   4. Enable APIs once:
#        gcloud services enable run.googleapis.com \
#                               cloudbuild.googleapis.com \
#                               artifactregistry.googleapis.com
#   5. Export DATABASE_URL in your shell (same value used on Railway).
#
# Usage:
#   DATABASE_URL="postgresql://..." ./scripts/deploy-cloudrun.sh
#
# Overrides (env vars):
#   SERVICE=chess-distance-api   (Cloud Run service name)
#   REGION=europe-west1          (closest to the user — Italy is covered here)
#   MIN_INSTANCES=1              (1 = always-warm, graph stays loaded, ~$5–8/mo.
#                                 Set to 0 for free-tier-only with 12–26s cold start)
#   MEMORY=1Gi                   (graph cache sits in RAM; 1Gi is a safe floor)
#   CPU=1                        (bump to 2 if BFS times out under load)
#   CORS_ORIGIN=https://chess-distance.vercel.app

set -euo pipefail

SERVICE="${SERVICE:-chess-distance-api}"
REGION="${REGION:-europe-west1}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"
MEMORY="${MEMORY:-1Gi}"
CPU="${CPU:-1}"
CORS_ORIGIN="${CORS_ORIGIN:-https://chess-distance.vercel.app}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "✗ DATABASE_URL is not set. Export it before running this script." >&2
  echo "  Example: DATABASE_URL=\"postgresql://...\" ./scripts/deploy-cloudrun.sh" >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "✗ gcloud CLI not found on PATH. Install: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ -z "${PROJECT}" ]]; then
  echo "✗ No gcloud project configured. Run: gcloud config set project <PROJECT_ID>" >&2
  exit 1
fi

echo "→ Project       : ${PROJECT}"
echo "→ Service       : ${SERVICE}"
echo "→ Region        : ${REGION}"
echo "→ Min instances : ${MIN_INSTANCES}  (0 = scale-to-zero, >0 = always warm)"
echo "→ Memory / CPU  : ${MEMORY} / ${CPU} vCPU"
echo "→ CORS origin   : ${CORS_ORIGIN}"
echo

# --source . uploads the working tree (respecting .gcloudignore) and builds via
# Cloud Build using Dockerfile.api. Cloud Run injects $PORT at runtime.
gcloud run deploy "${SERVICE}" \
  --source . \
  --dockerfile Dockerfile.api \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances "${MIN_INSTANCES}" \
  --max-instances 5 \
  --memory "${MEMORY}" \
  --cpu "${CPU}" \
  --cpu-boost \
  --timeout 60 \
  --concurrency 40 \
  --set-env-vars "DATABASE_URL=${DATABASE_URL},CORS_ORIGIN=${CORS_ORIGIN}"

URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)')"
echo
echo "✓ Deployed: ${URL}"
echo
echo "Next steps:"
echo "  1. Smoke-test:"
echo "       SMOKE_API_BASE=\"${URL}\" npm run smoke"
echo
echo "  2. Point Vercel at the new backend:"
echo "       Vercel → chess-distance → Settings → Environment Variables"
echo "       Add  NEXT_PUBLIC_API_BASE=${URL}  (production scope), then redeploy"
echo
echo "  3. Remove the CORS hardcode if your Vercel URL changes:"
echo "       Edit api/main.py :: _allowed_origins"
