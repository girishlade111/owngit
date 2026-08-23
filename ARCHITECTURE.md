# LSGit Architecture Overview

## Executive Summary

LSGit is a developer-first Git hosting platform inspired by GitLab's architecture but built with modern technology choices. This document describes the high-level system architecture, component interactions, and design principles.

## Core Design Principles

1. **Developer-First**: Optimize for developer experience (DX) over operational convenience
2. **Modular Monolith**: Start as a single deployable unit with clear internal boundaries for future decomposition
3. **Git-Native**: Git operations are first-class citizens, not afterthoughts
4. **Scalable by Default**: Architecture supports horizontal scaling from day one
5. **Open Standards**: Prefer open protocols (Git, SSH, HTTP, gRPC, GraphQL) over proprietary solutions
6. **Security by Design**: Authentication, authorization, and audit logging built into every layer

## High-Level Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LSGit Platform                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Web UI    │  │  REST API   │  │ GraphQL API │  │  Git HTTP   │        │
│  │  (SPA)      │  │  (v1)       │  │             │  │  (Smart)    │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │                │
│         └────────────────┼────────────────┼────────────────┘                │
│                          ▼                                                │
│              ┌─────────────────────┐                                      │
│              │   API Gateway       │                                      │
│              │   (Rate Limit,      │                                      │
│              │    Auth, Routing)   │                                      │
│              └──────────┬──────────┘                                      │
│                         │                                                 │
│         ┌───────────────┼───────────────┐                                 │
│         ▼               ▼               ▼                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                         │
│  │  Web App    │ │  Git Service│ │  Background │                         │
│  │  (Core)     │ │  (Gitaly-   │ │  Workers    │                         │
│  │             │ │   like)     │ │  (Sidekiq-  │                         │
│  │             │ │             │ │   like)     │                         │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘                         │
│         │               │               │                                 │
│         └───────────────┼───────────────┘                                 │
│                         ▼                                                 │
│  ┌─────────────────────────────────────────────────────────────┐         │
│  │                    Data Layer                                │         │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │         │
│  │  │PostgreSQL│  │  Redis   │  │  Git     │  │  Object  │    │         │
│  │  │(Primary) │  │(Cache/   │  │  Storage │  │  Storage │    │         │
│  │  │          │  │ Queues)  │  │  (Gitaly)│  │  (S3)    │    │         │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │         │
│  └─────────────────────────────────────────────────────────────┘         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. API Gateway
- **Technology**: NGINX / Envoy / Custom Go/Rust proxy
- **Responsibilities**:
  - TLS termination
  - Rate limiting (per IP, per user, per token)
  - Request routing (REST, GraphQL, Git HTTP, Git SSH)
  - Authentication validation (JWT, PAT, session cookies)
  - Request/response logging and metrics
  - DDoS protection basics

### 2. Web Application (Core)
- **Technology**: Rust (Axum/Actix) or Go (Chi/Gin) - TBD
- **Framework**: Modular monolith with clear domain boundaries
- **Responsibilities**:
  - Business logic for all domain entities
  - REST API implementation
  - GraphQL API implementation
  - Web UI server-side rendering / API for SPA
  - Authorization enforcement
  - Event publishing
  - Background job enqueuing

### 3. Git Service (Gitaly-like)
- **Technology**: Rust (git2-rs) or Go (go-git) - TBD
- **Protocol**: gRPC with Protocol Buffers
- **Responsibilities**:
  - All Git operations (clone, push, fetch, archive)
  - Repository metadata (branches, tags, commits, diffs)
  - Git LFS support
  - Repository creation/deletion
  - Hook execution (pre-receive, post-receive)
  - Conflict detection for concurrent writes
- **Scaling**: Stateless workers with shared object storage backend

### 4. Background Workers
- **Technology**: Same language as Web App (shared codebase)
- **Queue Backend**: Redis with reliable queue patterns
- **Responsibilities**:
  - CI/CD job execution coordination
  - Webhook delivery with retries
  - Email notifications
  - Repository mirroring
  - Artifact processing
  - Search indexing
  - Scheduled tasks (cleanup, reports)

### 5. Git SSH Service (GitLab Shell-like)
- **Technology**: Rust/Go SSH server
- **Responsibilities**:
  - SSH key authentication and authorization
  - Command parsing (git-upload-pack, git-receive-pack)
  - Delegation to Git Service via gRPC
  - Audit logging of SSH operations

## Data Flow Examples

### Git Clone (HTTP)
```
Client → API Gateway → Web App (auth) → Git Service (gRPC) → Object Storage
                          ↓
                   Response streamed via Workhorse-like component
```

### Git Push (SSH)
```
Client → SSH Service → Auth check (Web App internal API) → Git Service (gRPC)
                                                    ↓
                                         Post-receive hooks → Background Workers
```

### Merge Request Creation
```
Client → API Gateway → Web App (REST/GraphQL) → PostgreSQL (transaction)
                                                    ↓
                                         Event published → Background Workers
                                                    ↓
                                         Notifications, CI trigger, Search index
```

## Technology Stack Decisions

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Primary Language | **Rust** or **Go** | Performance, safety, concurrency, ecosystem |
| Web Framework | **Axum** (Rust) / **Chi** (Go) | Modern, async, middleware support |
| Database | **PostgreSQL 16+** | ACID, JSONB, extensions, maturity |
| Cache/Queue | **Redis 7+** | Performance, pub/sub, streams, Lua scripting |
| Git Backend | **git2-rs** (Rust) / **go-git** (Go) | Native Git implementation, no shell-out |
| gRPC | **tonic** (Rust) / **grpc-go** | First-class gRPC support |
| GraphQL | **async-graphql** (Rust) / **gqlgen** (Go) | Schema-first, performance |
| Object Storage | **S3 API compatible** | Industry standard, multi-vendor |
| Search | **Meilisearch** or **Typesense** | Simpler than Elasticsearch, good DX |
| Metrics | **Prometheus + Grafana** | Industry standard |
| Logging | **OpenTelemetry** | Vendor-neutral observability |
| Deployment | **Docker + Kubernetes** | Cloud-native, portable |

## Architectural Boundaries

### Domain Modules (Bounded Contexts)
1. **Identity & Access**: Users, authentication, sessions, OAuth, LDAP
2. **Projects & Repositories**: Projects, repositories, Git operations, LFS
3. **Collaboration**: Issues, merge requests, discussions, labels, milestones
4. **CI/CD**: Pipelines, jobs, runners, artifacts, variables, environments
5. **Packages & Registry**: Package registry, container registry, dependency proxy
6. **Security**: SAST, DAST, dependency scanning, secret detection, compliance
7. **Administration**: Instance settings, audit logs, abuse reports, system hooks
8. **Organization**: Groups, subgroups, members, custom roles, namespaces

### Communication Patterns
- **Synchronous**: gRPC (internal), REST/GraphQL (external)
- **Asynchronous**: Redis Streams / Kafka (event bus), Redis Lists (job queues)
- **Event-Driven**: Domain events published after transaction commit

## Deployment Topology

### Development (Single Node)
```
All services in one process or docker-compose:
- Web App + Git Service + Workers + PostgreSQL + Redis + MinIO
```

### Production (Horizontal Scale)
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Load       │     │  API        │     │  Web App    │
│  Balancer   │────▶│  Gateway    │────▶│  (N pods)   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
             ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
             │  Git Svc    │            │  Workers    │            │  SSH Svc    │
             │  (N pods)   │            │  (N pods)   │            │  (N pods)   │
             └──────┬──────┘            └─────────────┘            └─────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
   ┌──────────┐           ┌──────────┐
   │PostgreSQL│           │  Redis   │
   │(Primary +│           │(Cluster) │
   │ Replicas)│           └──────────┘
   └──────────┘                    │
         │                         │
         ▼                         ▼
   ┌──────────┐           ┌──────────┐
   │  Object  │           │  Search  │
   │  Storage │           │  Engine  │
   │  (S3)    │           │          │
   └──────────┘           └──────────┘
```

## Scaling Strategy

| Component | Scaling Approach |
|-----------|------------------|
| Web App | Horizontal (stateless), connection pooling to DB |
| Git Service | Horizontal (stateless), shared object storage |
| Workers | Horizontal per queue/shard, specialized pools |
| PostgreSQL | Read replicas, connection pooling (PgBouncer), logical sharding later |
| Redis | Cluster mode, separate instances for cache/queues/persistent |
| Object Storage | Managed service (S3/GCS/Azure) or MinIO cluster |

## Technical Debt & Risks (Identified Early)

| Risk | Impact | Mitigation |
|------|--------|------------|
| Git backend choice (git2-rs vs go-git) | High - core to product | Prototype both, benchmark |
| Single PostgreSQL instance | Medium - scaling ceiling | Design for logical sharding from start |
| Custom Git service vs Gitaly | High - development effort | Start simple, extract if needed |
| Background job reliability | High - data loss risk | Idempotent jobs, dead letter queues |
| WebSocket/real-time support | Medium - complexity | Use existing solutions (Centrifugo, Socket.io) |
| Multi-tenancy / Cells | Low initially - plan for it | Organization-level sharding keys in schema |

## Open Decisions Requiring Input

**Question**: Which primary language should LSGit use: Rust or Go?

**Recommended**: A. **Rust** - Better memory safety, performance, async ecosystem, git2-rs is mature

**Alternative**: B. **Go** - Faster compile times, larger talent pool, simpler concurrency model

**Alternative**: C. **Polyglot** - Rust for Git service, Go for Web App - Best of both but more complex

---

*This document will evolve as implementation decisions are made.*