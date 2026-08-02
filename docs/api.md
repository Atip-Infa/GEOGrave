# API Reference

Base URL: `http://localhost:3000` (development) or your deployment host.

All request and response bodies are `application/json` unless noted. Authenticated endpoints require `Authorization: Bearer <token>` obtained from the login endpoint.

---

## Table of Contents

- [Authentication](#authentication)
- [PII redaction](#pii-redaction)
- [Pagination](#pagination)
- [Rate limiting](#rate-limiting)
- [Error responses](#error-responses)
- [Endpoints](#endpoints)
  - [POST /api/auth/login](#post-apiauthlogin)
  - [GET /api/points](#get-apipoints)
  - [GET /api/points/near](#get-apipointsnear)
  - [GET /api/points/:id](#get-apipointsid)
  - [POST /api/points](#post-apipoints)
  - [PUT /api/points/:id](#put-apipointsid)
  - [DELETE /api/points/:id](#delete-apipointsid)
  - [GET /api/stats](#get-apistats)
  - [GET /healthz](#get-healthz)

---

## Authentication

Staff authentication uses JWT (HS256, 8-hour expiry).

1. Call `POST /api/auth/login` with staff credentials.
2. Include the returned token in subsequent requests: `Authorization: Bearer <token>`.

Tokens are stateless — there is no server-side session store. Expiry is enforced at verification time.

---

## PII redaction

The `reporterIdCard` field (Thai national ID number) is **never** included in responses to unauthenticated callers. All other fields are public.

This applies to every endpoint that returns report objects: `GET /api/points`, `GET /api/points/near`, `GET /api/points/:id`, and `POST /api/points`.

---

## Pagination

`GET /api/points` supports optional cursor-free pagination:

| Query param | Default | Max | Description |
|---|---|---|---|
| `limit` | (all) | 500 | Number of records per page |
| `offset` | 0 | — | Number of records to skip |

When `limit` is provided, the response includes an `X-Total-Count` header with the total number of records, allowing clients to build a paginator without a second request.

When `limit` is omitted, the full result set is returned (original behaviour).

---

## Rate limiting

| Scope | Window | Limit |
|---|---|---|
| All `/api/` routes | 15 minutes | 300 requests |
| `POST /api/auth/login` | 15 minutes | 10 requests |
| `POST /api/points` | 15 minutes | 60 requests |

Limits are per-IP. `RateLimit-*` headers are included in responses (RFC 6585 standard headers).

---

## Error responses

All error responses follow this shape:

```json
{
  "error": "Human-readable message"
}
```

Validation failures include per-field detail:

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "lat", "message": "lat must be a number between -90 and 90" },
    { "field": "victimName", "message": "victimName is required" }
  ]
}
```

| Status | When |
|---|---|
| 400 | Validation failed, unsupported file type, malformed request body |
| 401 | Missing or invalid/expired token |
| 404 | Resource not found |
| 413 | Uploaded file exceeds 10 MB |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error (detail hidden in production) |

---

## Endpoints

### POST /api/auth/login

Authenticate as staff and receive a JWT.

**Auth required:** No

**Request body:**

```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response `200 OK`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "username": "admin",
  "expiresIn": "8h"
}
```

**Error responses:**

| Status | Body |
|---|---|
| 400 | `{ "error": "username and password required" }` |
| 401 | `{ "error": "Invalid credentials" }` |

---

### GET /api/points

List all reports. Supports optional pagination.

**Auth required:** No (authenticated callers receive `reporterIdCard` in each record)

**Query parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `limit` | integer 1–500 | No | Page size |
| `offset` | integer ≥ 0 | No | Number of records to skip |

**Response `200 OK`:** JSON array of report objects, ordered newest-first (`created_at DESC`).

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "lat": 13.7563,
    "lng": 100.5018,
    "victimName": "Test Name",
    "victimAge": 45,
    "victimGender": "ชาย",
    "causeOfDeath": "อุบัติเหตุจราจร",
    "reportedDate": "2025-06-15",
    "reportedTime": "14:30",
    "locationOfDeath": "ถนนสุขุมวิท กรุงเทพฯ",
    "destinationTemple": "วัดไตรมิตรวิทยาราม",
    "reportedBy": "เจ้าหน้าที่",
    "attachments": [
      {
        "id": "661e9511-f30c-52e5-b827-557766551111",
        "filename": "photo.jpg",
        "url": "/uploads/a3b4c5d6-e7f8-90ab-cdef-123456789012.jpg"
      }
    ],
    "createdAt": "2025-06-15T07:30:00.000Z",
    "updatedAt": "2025-06-15T09:15:00.000Z"
  }
]
```

Note: `reporterIdCard` is absent for unauthenticated callers. Authenticated staff receive it as `"reporterIdCard": "1234567890123"`. `victimAge` is an integer or `""` when not recorded. `updatedAt` is absent if the record has never been updated.

---

### GET /api/points/near

Reports within a given radius of a coordinate, sorted nearest-first. Each result is annotated with `distanceKm`. Backed by an R-Tree spatial index (see [docs/database.md](database.md)).

**Auth required:** No (authenticated callers receive `reporterIdCard`)

**Query parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `lat` | float -90..90 | **Yes** | Search centre latitude |
| `lng` | float -180..180 | **Yes** | Search centre longitude |
| `radius_km` | float 0..500 | No | Search radius in kilometres (default: 5) |

**Example request:**

```
GET /api/points/near?lat=13.7563&lng=100.5018&radius_km=5
```

**Response `200 OK`:**

```json
{
  "center": { "lat": 13.7563, "lng": 100.5018 },
  "radiusKm": 5,
  "count": 2,
  "points": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "lat": 13.7563,
      "lng": 100.5018,
      "victimName": "Near Bangkok",
      "distanceKm": 0.001,
      ...
    },
    {
      "id": "661e9511-f30c-52e5-b827-557766551111",
      "lat": 13.7601,
      "lng": 100.5050,
      "victimName": "Nearby Report",
      "distanceKm": 0.512,
      ...
    }
  ]
}
```

**Error responses:**

| Status | Condition |
|---|---|
| 400 | `lat` out of range, `lng` out of range, or `radius_km` out of range / non-numeric |

---

### GET /api/points/:id

Get a single report by its UUID.

**Auth required:** No (authenticated callers receive `reporterIdCard`)

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `id` | UUID v4 | Report identifier |

**Response `200 OK`:** same shape as a single element from `GET /api/points`.

**Error responses:**

| Status | Condition |
|---|---|
| 400 | `id` is not a valid UUID |
| 404 | Report not found |

---

### POST /api/points

Create a new report. Accepts `multipart/form-data` (required for file attachments).

**Auth required:** No

**Request fields:**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `lat` | float | **Yes** | -90..90, not (0,0) |
| `lng` | float | **Yes** | -180..180, not (0,0) |
| `victimName` | string | **Yes** | Max 200 chars |
| `victimAge` | integer | No | 0..150 |
| `victimGender` | string | No | Max 50 chars |
| `causeOfDeath` | string | No | Max 500 chars |
| `reportedDate` | string | No | ISO 8601 date (YYYY-MM-DD) |
| `reportedTime` | string | No | HH:MM |
| `locationOfDeath` | string | No | Max 300 chars |
| `destinationTemple` | string | No | Max 300 chars |
| `reportedBy` | string | No | Max 200 chars |
| `reporterPhone` | string | No | Thai phone number, 7–20 chars (digits, dashes, spaces, +, brackets) |
| `reporterIdCard` | string | No | Exactly 13 digits |
| `attachments` | file(s) | No | Up to 5 files; JPG/PNG/WEBP/GIF/PDF; max 10 MB each |

**Example curl:**

```bash
curl -X POST http://localhost:3000/api/points \
  -F "lat=13.7563" \
  -F "lng=100.5018" \
  -F "victimName=Test Victim" \
  -F "causeOfDeath=อุบัติเหตุจราจร" \
  -F "reporterIdCard=1234567890123" \
  -F "attachments=@/path/to/photo.jpg"
```

**Response `201 Created`:** the created report object (same shape as `GET /api/points/:id`). `reporterIdCard` is redacted for the creating caller (consistent with unauthenticated GET behaviour).

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Validation failed (see error body for per-field details) |
| 400 | Unsupported file type |
| 413 | File exceeds 10 MB |
| 429 | Rate limit exceeded |

---

### PUT /api/points/:id

Partially update a report. All fields are optional — only provided fields are updated.

**Auth required:** **Yes**

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `id` | UUID v4 | Report identifier |

**Request:** `multipart/form-data`. Same fields as `POST /api/points`, all optional. New attachments are appended; existing attachments are not removed.

**Response `200 OK`:** the updated report object.

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Validation failed |
| 401 | Missing or invalid token |
| 404 | Report not found |

---

### DELETE /api/points/:id

Delete a report and all its attachments.

**Auth required:** **Yes**

Attachment rows are deleted automatically via `ON DELETE CASCADE` — no separate cleanup step is needed.

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `id` | UUID v4 | Report identifier |

**Response `204 No Content`:** empty body.

**Error responses:**

| Status | Condition |
|---|---|
| 400 | `id` is not a valid UUID |
| 401 | Missing or invalid token |
| 404 | Report not found |

---

### GET /api/stats

Summary statistics for the dashboard. Cached in-process with explicit invalidation on every write (see [docs/database.md — Caching](database.md#caching)).

**Auth required:** No

**Response `200 OK`:**

```json
{
  "total": 142,
  "byGender": {
    "ชาย": 98,
    "หญิง": 37,
    "ไม่ทราบ": 7
  },
  "recent": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "victimName": "Test Name",
      "locationOfDeath": "ถนนสุขุมวิท กรุงเทพฯ",
      "createdAt": "2025-06-15T07:30:00.000Z"
    }
  ]
}
```

`recent` contains up to 5 most-recently created reports. `byGender` uses `ไม่ทราบ` (unknown) for records with a null or empty `victim_gender`.

---

### GET /healthz

Health check endpoint. Verifies that the database is reachable (executes a real query), not just that the process is running.

**Auth required:** No

**Response `200 OK`:**

```json
{
  "status": "ok",
  "uptime": 3612.4,
  "database": {
    "connected": true,
    "reportCount": 142,
    "sizeKb": 2048
  }
}
```

**Response `503 Service Unavailable`** (database unreachable):

```json
{
  "status": "error",
  "error": "database unreachable"
}
```

Used by Docker's `HEALTHCHECK` directive and any load balancer or monitoring system.
