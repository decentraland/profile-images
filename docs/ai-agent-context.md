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

1. Producer polls Catalyst for profile changes
2. Detects new/updated profiles, queues rendering job to SQS
3. Consumer receives job, fetches avatar data
4. Consumer renders 3D avatar to 2D images (body, face)
5. Consumer uploads images to S3
6. Images served via CDN for applications
