# Contributing to GEOGrave

Thank you for taking the time to contribute. This document covers everything you need to get a working development environment, the conventions the project follows, and the pull request process.

---

## Table of Contents

- [Code of conduct](#code-of-conduct)
- [Getting started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local setup](#local-setup)
  - [Running the test suite](#running-the-test-suite)
- [Project structure](#project-structure)
- [Branch and commit conventions](#branch-and-commit-conventions)
- [Pull request process](#pull-request-process)
- [Coding standards](#coding-standards)
- [Database changes](#database-changes)
- [Reporting bugs](#reporting-bugs)
- [Security vulnerabilities](#security-vulnerabilities)

---

## Code of conduct

Be respectful and constructive. Harassment of any kind will not be tolerated. If you experience or witness unacceptable behaviour, open a GitHub issue or contact the maintainers directly.

---

## Getting started

### Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 22.5.0 | Uses the built-in `node:sqlite` module added in 22.5 |
| npm | 10+ | Comes with Node 22 |
| Docker | 24+ | Optional — only needed for container-based dev/testing |
| Git | 2.40+ | |

Check your Node version with `node --version` before starting.

### Local setup

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/geograve.git
cd geograve

# 2. Add the upstream remote so you can pull in future changes
git remote add upstream https://github.com/Atip-Infa/geograve.git

# 3. Install dependencies
cd backend
npm install

# 4. Configure environment variables
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 5. Start the development server
npm run dev
# Open http://localhost:3000
```

To seed the database with realistic sample data for local testing:

```bash
npm run db:seed        # 20 reports (default)
npm run db:seed -- 50  # custom count
```

### Running the test suite

```bash
cd backend
npm test
```

Tests use isolated temporary SQLite databases — they never touch `backend/data/` or `backend/uploads/`. The full suite (43 tests) should pass in under 10 seconds on any modern machine.

To run a single test file during development:

```bash
npx jest tests/db.test.js --runInBand
npx jest tests/api.test.js --runInBand
```

---

## Project structure

```
geograve/
├── .github/
│   ├── workflows/ci.yml          # CI: test matrix + Docker smoke test
│   ├── ISSUE_TEMPLATE/           # Bug report and feature request templates
│   └── PULL_REQUEST_TEMPLATE.md
├── backend/
│   ├── lib/
│   │   ├── db/
│   │   │   ├── connection.js     # SQLite connection, WAL pragma, migration runner
│   │   │   ├── migrate.js        # Migration system (tracks applied versions)
│   │   │   ├── migrations/       # Numbered .sql migration files
│   │   │   ├── prepared-cache.js # Per-connection prepared statement cache
│   │   │   ├── reports-repo.js   # Data access layer for reports + attachments
│   │   │   └── users-repo.js     # Data access layer for users
│   │   ├── geo.js                # Haversine distance + radius search
│   │   └── upload.js             # Multer config with MIME/extension whitelist
│   ├── middleware/
│   │   ├── auth.js               # JWT issue/verify middleware
│   │   └── validate.js           # express-validator rules + upload cleanup
│   ├── public/                   # Static frontend (no build step)
│   │   ├── css/style.css
│   │   ├── index.html
│   │   └── js/                   # ES modules: main, state, api, map-view, etc.
│   ├── scripts/
│   │   ├── backup.js             # VACUUM INTO backup
│   │   ├── data-quality-check.js # Read-only data audit
│   │   ├── migrate-json-to-sqlite.js # ETL from legacy JSON store
│   │   └── seed.js               # Dev/demo data seeder
│   ├── tests/
│   │   ├── api.test.js           # HTTP integration tests
│   │   ├── db.test.js            # Database layer + query plan tests
│   │   └── geo.test.js           # Haversine unit tests
│   ├── .env.example
│   ├── Dockerfile
│   ├── package.json
│   └── server.js                 # Express app entry point
├── docs/                         # Extended documentation
├── docker-compose.yml
├── CHANGELOG.md
├── CONTRIBUTING.md               # This file
├── LICENSE
├── README.md
└── SECURITY.md
```

---

## Branch and commit conventions

### Branches

Branch names follow the pattern `<type>/<short-description>`:

| Type | When to use |
|---|---|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `refactor/` | Code change with no behaviour change |
| `test/` | Adding or fixing tests |
| `chore/` | Tooling, deps, CI |
| `db/` | Schema migrations or database layer changes |

Examples: `feat/pagination-api`, `fix/orphaned-upload-cleanup`, `db/add-province-column`

### Commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary>

<optional body>

<optional footer>
```

Examples:

```
feat(api): add cursor-based pagination to GET /api/points
fix(upload): delete orphaned file when later validation fails
db(migrations): add province column to reports table
docs: expand spatial indexing section in database.md
test(db): assert EXPLAIN QUERY PLAN uses idx_reports_created_at
```

Keep the summary line under 72 characters. Use the body to explain *why*, not *what* — the diff shows what changed.

---

## Pull request process

1. **Open an issue first** for any non-trivial change so the approach can be discussed before you write code. This avoids wasted effort on rejected directions.

2. **Create a focused branch** off the latest `main`:
   ```bash
   git fetch upstream
   git checkout -b feat/your-feature upstream/main
   ```

3. **Write or update tests.** New behaviour should have a test. Bug fixes should have a regression test that fails before the fix and passes after.

4. **Ensure the full test suite passes** before opening the PR:
   ```bash
   cd backend && npm test
   ```

5. **Fill in the PR template** completely. Reviewers should be able to understand the motivation, the approach, and how to verify the change without asking questions.

6. **Schema changes must include a migration.** Add a new numbered file in `backend/lib/db/migrations/`. See [Database changes](#database-changes) below.

7. PRs that touch security-sensitive areas (auth, file uploads, PII handling, rate limiting) will receive extra scrutiny and may require a second reviewer.

8. Squash or rebase before merge to keep `main` history linear and readable.

---

## Coding standards

- **Style:** 2-space indentation, single quotes, no semicolons on standalone statements is the existing convention — match it. An `.editorconfig` is provided for basic whitespace consistency.
- **No new runtime dependencies** without discussion. The existing dependency footprint is intentionally small.
- **SQL in migration files only.** Schema changes belong in a new `NNN_description.sql` file, not scattered across application code.
- **snake_case for database columns, camelCase for JavaScript.** The mapping lives exclusively in `reports-repo.js#toApiShape` — keep it there.
- **Sensitive fields** (`reporterIdCard`) must go through the `STAFF_ONLY_FIELDS` redaction path in `server.js`. Do not add new PII fields without updating that list.
- **Prepared statements** for any query that runs more than once — use `lib/db/prepared-cache.js#prep()`. Do not call `db.prepare()` inside a loop.

---

## Database changes

1. Create a new migration file: `backend/lib/db/migrations/NNN_description.sql` where `NNN` is the next sequential number (zero-padded to three digits).

2. Write the migration as idempotent SQL where possible (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

3. Update `docs/database.md` to reflect the schema change.

4. If adding a column that feeds a hot-path query, add an `EXPLAIN QUERY PLAN` assertion to `tests/db.test.js`.

5. Run the full test suite — the migration runner is exercised by `tests/db.test.js` and a broken migration will fail fast there.

---

## Reporting bugs

Open a [GitHub issue](https://github.com/Atip-Infa/geograve/issues/new?template=bug_report.md) using the bug report template. Include:

- Steps to reproduce
- Expected behaviour
- Actual behaviour
- Node version (`node --version`)
- Whether you're using Docker

---

## Security vulnerabilities

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.
