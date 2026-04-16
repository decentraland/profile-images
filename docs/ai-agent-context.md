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

1. Producer (external — `deployments-to-sqs` service) monitors Catalyst and publishes `CatalystDeploymentEvent` messages to SQS via the EVENTS SNS topic.
2. Consumer receives job, fetches avatar data (from message payload or Catalyst fallback).
3. Consumer computes a SHA-256 hash of the incoming avatar's visually-relevant fields.
4. Consumer reads the previously-stored hash from S3 object metadata on `body.png` (via HeadObject).
5. **If hash matches**: skip Godot entirely — return synthetic success, delete SQS message. No re-render.
6. **If hash differs or no body.png exists**: invoke Godot renderer to produce body + face images.
7. On success: upload images to S3 with the new avatar hash stored as metadata on `body.png`.
8. On Godot failure (single entity): write failure record. No cleanup needed — `body.png` was never overwritten.
9. Images served via CDN for applications.

**Change Detection Notes:**

- Hash is computed from a canonical JSON of: `bodyShape` (lowercased), `wearables` (sorted+lowercased), `forceRender` (sorted+lowercased), `eyes/hair/skin` colors (rounded to 4 decimal places).
- The hash is stored as S3 user-defined metadata (`avatar-hash`) on the existing `body.png` — no separate files needed.
- S3 HeadObject errors are treated as "force render" (non-fatal degradation).
- Pre-existing `body.png` without metadata triggers a re-render that writes the metadata (self-healing).
- A `snapshot_generation_count { status: 'skipped' }` metric is incremented for each skipped entity.
