# Profile Images Service

[![Coverage Status](https://coveralls.io/repos/github/decentraland/profile-images/badge.svg?branch=coverage)](https://coveralls.io/github/decentraland/profile-images?branch=coverage)

This service generates profile images from users' 3D avatar models, producing both body and face images. These images are stored in S3 and exposed via an API, allowing them to be seamlessly integrated into any desired application.

This server interacts with Catalyst for profile entity monitoring, AWS SQS for rendering job queues, and AWS S3 for image storage in order to provide applications with 2D profile images generated from 3D avatar models.

## Table of Contents

- [Features](#features)
- [Dependencies & Related Services](#dependencies--related-services)
- [API Documentation](#api-documentation)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running the Service](#running-the-service)
- [Testing](#testing)
- [How to Contribute](#how-to-contribute)
- [License](#license)

## Features

- **Profile Image Generation**: Generates 2D profile images (body and face) from 3D avatar models
- **Producer-Consumer Pattern**: Monitors profile changes via Catalyst and processes rendering jobs via SQS
- **Automatic Processing**: Detects new/updated profiles and automatically queues rendering jobs
- **Retry Mechanism**: Supports retry queue for failed rendering jobs
- **CDN Integration**: Stores generated images in S3 for CDN distribution
- **REST API**: Exposes API endpoints for retrieving generated profile images

## Dependencies & Related Services

This service interacts with the following services:

- **[Catalyst](https://github.com/decentraland/catalyst)**: Content server for profile entity fetching and pointer changes monitoring

External dependencies:

- **AWS SQS**: Message queue for rendering jobs and retry queue
- **AWS S3**: Object storage for generated profile images
- **LocalStack** (for local development): Local AWS services emulation

## API Documentation

The service provides REST API endpoints for retrieving generated profile images. See the service code for endpoint documentation.

## Getting Started

### Prerequisites

Before running this service, ensure you have the following installed:

- **Node.js**: Version 16.x or higher (LTS recommended)
- **Yarn**: Version 1.22.x or higher
- **Docker**: For containerized deployment and local development dependencies
- **LocalStack CLI** (for local development): Install with `brew install localstack/tap/localstack-cli` on macOS
- **awslocal CLI** (for local development): Install with `pip3 install awscli --upgrade --user` on macOS

### Installation

1. Clone the repository:

```bash
git clone https://github.com/decentraland/profile-images.git
cd profile-images
```

2. Install dependencies:

```bash
yarn install
```

3. Build the project:

```bash
yarn build
```

### Configuration

The service uses environment variables for configuration. Create a `.env` file in the root directory containing the environment variables for the service to run.

Key configuration variables include:

- `QUEUE_URL`: SQS queue URL for rendering jobs
- `DLQ_URL`: SQS dead letter queue URL for failed jobs
- `S3_BUCKET`: S3 bucket name for storing images
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`: AWS credentials
- `AWS_ENDPOINT`: AWS endpoint (use LocalStack endpoint for local development)
- `PEER_URL`: Catalyst peer URL for profile entity fetching

### Running the Service

#### Setting up the environment

In order to successfully run this server, external dependencies such as message queues and storage must be provided.

For local development, this repository provides you with a `docker-compose.yml` file that includes LocalStack for AWS services emulation. In order to get the environment set up, run:

```bash
docker-compose up -d
```

This will start:
- LocalStack (SQS and S3 emulation) on port `4566`

#### Manual LocalStack Setup (Alternative)

If you prefer to run LocalStack manually:

1. Set environment variables:

```bash
export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"
export AWS_DEFAULT_REGION="us-east-1"
export AWS_ENDPOINT="http://localhost:4566"
```

2. Start LocalStack:

```bash
localstack start
```

3. Create SQS queues:

```bash
awslocal sqs create-queue --queue-name profile-images-queue
awslocal sqs create-queue --queue-name profile-images-dlq
```

4. Create S3 bucket:

```bash
awslocal s3api create-bucket --bucket profile-images-bucket
```

#### Running in development mode

Once the environment is set up, start the service:

```bash
yarn start
```

The service will:
- Poll Catalyst for profile changes
- Process rendering jobs from SQS
- Generate profile images
- Upload images to S3

## Testing

This service includes comprehensive test coverage.

### Running Tests

Run all tests:

```bash
yarn test
```

Run tests with coverage:

```bash
yarn test:coverage
```

### Test Structure

- **Unit Tests**: Test individual components and functions in isolation
- **Integration Tests**: Test the complete rendering workflow

For detailed testing guidelines and standards, refer to our [Testing Standards](https://github.com/decentraland/docs/tree/main/development-standards/testing-standards) documentation.

## Architecture

The service uses a producer-consumer pattern:

```mermaid
sequenceDiagram
    participant Deployments as Deployments-to-SQS
    participant SQS as SQS Queue
    participant Service as Profile Images Service
    participant Godot as Godot Generator
    participant S3 as S3 Storage

    Deployments->>SQS: Push profile deployment events
    loop Continuous Processing
        SQS->>Service: Receive messages
        Service->>Godot: Generate images
        Godot-->>Service: Return image paths
        Service->>S3: Store images
        Service->>SQS: Delete processed messages
    end
```

**Workflow:**

1. Producer polls Catalyst for profile changes
2. Detects new/updated profiles, queues rendering job to SQS
3. Consumer receives job, fetches avatar data
4. Consumer renders 3D avatar to 2D images (body, face)
5. Consumer uploads images to S3
6. Images served via CDN for applications

## Comparing Images

For debugging and comparison purposes, you can generate a list of entities and compare images:

```bash
http https://peer.decentraland.org/content/deployments | jq '.deployments[] | select(.entityType == "profile") | .entityId' | cut -d\" -f2  | sort | uniq > entities
cat entities | bin/compare.sh
```

## AI Agent Context

For detailed AI Agent context, see [docs/ai-agent-context.md](docs/ai-agent-context.md).

---

**Note**: This service requires a 3D rendering pipeline (Godot or similar) to generate images from avatar models. Ensure the rendering service is properly configured before running the service.
