# AI Agent Context

**Service Purpose:** Generates 2D profile images (body and face) from 3D avatar models. Uses a producer-consumer pattern to monitor profile changes and render avatar images for display in applications, social features, and user interfaces.

**Key Capabilities:**

- **Producer Service**: Polls Catalyst for profile deployments, detects avatar changes, queues rendering jobs to SQS
- **Consumer Service**: Processes rendering jobs, generates avatar images using 3D rendering pipeline, uploads images to S3
- Monitors profile entity changes via Catalyst `/content/pointer-changes` endpoint
- Generates body and face images from avatar 3D models
- Stores generated images in S3 bucket for CDN distribution
- Supports retry queue for failed rendering jobs

**Communication Pattern:** 
- Polling-based (Producer polls Catalyst periodically)
- Event-driven via AWS SQS (Consumer processes rendering jobs)

**Technology Stack:**

- Runtime: Node.js
- Language: TypeScript
- Queue: AWS SQS (rendering job queue, retry queue)
- Storage: AWS S3 (generated profile images)
- Rendering: 3D avatar rendering pipeline (likely Unity or similar)

**External Dependencies:**

- Content Servers: Catalyst nodes (profile entity fetching, pointer changes monitoring)
- Queue: AWS SQS (rendering jobs, retry queue)
- Storage: AWS S3 (generated image storage)

**Workflow:**

1. Producer (external — `deployments-to-sqs` service) monitors Catalyst and publishes `CatalystDeploymentEvent` messages to SQS.
2. Consumer receives job, fetches avatar data (from message payload or Catalyst fallback).
3. Consumer reads previously-stored `AvatarInfo` from S3 (`entities/{entityId}/avatar.json`).
4. Consumer compares visually-relevant fields (bodyShape, wearables, colors, forceRender) with the incoming avatar.
5. **If unchanged**: skip Godot entirely — return synthetic success, delete SQS message. No re-render.
6. **If changed or first render**: invoke Godot renderer to produce body + face images.
7. On success: upload images to S3 and store the new `AvatarInfo` as `avatar.json` for future comparisons.
8. On Godot failure (single entity): write failure record, delete `avatar.json` so the next DLQ retry always re-renders.
9. Images served via CDN for applications.

**Change Detection Notes:**

- Comparison uses a canonical JSON of: `bodyShape` (lowercased), `wearables` (sorted+lowercased), `forceRender` (sorted+lowercased), `eyes/hair/skin` colors (rounded to 4 decimal places).
- S3 read errors during avatar info retrieval are treated as "force render" (non-fatal degradation).
- `avatar.json` is only written after `storeImages` succeeds; its own write failure is non-fatal (self-heals on next successful render).
- A `snapshot_generation_count { status: 'skipped' }` metric is incremented for each skipped entity.
