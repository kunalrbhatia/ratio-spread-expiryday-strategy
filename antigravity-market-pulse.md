# Antigravity CLI Prompt — Build `market-pulse`

You are building a standalone GitHub repository called **`market-pulse`**. This is a universal self-healing engine for algorithmic trading repos. When market conditions change (lot sizes, expiry days, broker API changes, holidays), this engine detects the change, clones every subscribed algo repo, patches the config, runs verification, and opens a PR. The human only reviews and merges.

The repo will be created on the user's local machine and pushed to GitHub under `kunalrbhatia/market-pulse`.

---

## What to build

Create a complete, production-ready Node.js/TypeScript project with the following structure:

```
market-pulse/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
│
├── engine.ts                    # Main loop — cron entry point
├── market-config.schema.json    # Standard config schema (JSON Schema)
│
├── monitors/
│   ├── base.ts                  # Abstract monitor interface
│   ├── nse-contract-specs.ts    # Checks NSE for lot size / expiry day changes
│   ├── nse-holidays.ts          # Fetches NSE holiday calendar
│   ├── broker-angel-one.ts      # Pings Angel One SmartAPI endpoints, checks auth
│   └── index.ts                 # Registry of all monitors
│
├── adapters/
│   ├── base.ts                  # Abstract adapter interface
│   ├── node-pnpm.ts             # Clones repo, updates config, runs pnpm verify
│   └── index.ts                 # Auto-detect adapter from repo files
│
├── subscribers/
│   ├── registry.ts              # Reads .market-pulse.yaml from subscribed repos
│   └── subscriber.schema.json   # Schema for .market-pulse.yaml
│
├── detectors/
│   ├── diff.ts                  # Compares old vs new config, generates patches
│   └── version.ts               # Config version management
│
├── github/
│   ├── client.ts                # gh CLI wrapper (clone, branch, commit, PR)
│   └── discover.ts              # Discover repos via GitHub topic "market-pulse"
│
├── __tests__/
│   ├── monitors.test.ts
│   ├── detectors.test.ts
│   ├── github.test.ts
│   └── engine.test.ts
│
├── scripts/
│   └── bootstrap.ts             # One-time setup: scan GitHub for subscribed repos
│
└── examples/
    └── ratio-spread/
        └── .market-pulse.yaml   # Example subscriber config
```

---

## Detailed requirements for each file

### 1. `package.json`

- Name: `market-pulse`
- Scripts:
  - `dev` — `ts-node engine.ts` (single run, detect + patch + PR)
  - `build` — `tsc`
  - `start` — `node dist/engine.js`
  - `test` — `jest --coverage`
  - `verify` — `pnpm lint && pnpm test && pnpm build`
  - `bootstrap` — `ts-node scripts/bootstrap.ts`
- Dependencies:
  - `typescript`, `ts-node`, `jest`, `ts-jest`
  - `node-fetch` or native fetch (Node 18+)
  - `zod` (for config validation)
  - `dayjs` (for date math)
  - (No framework — keep it minimal, CLI/pipeline oriented)

### 2. `market-config.schema.json`

JSON Schema defining the universal config shape that all subscribed repos should have:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "MarketConfig",
  "type": "object",
  "properties": {
    "version": { "type": "integer", "minimum": 1 },
    "lastUpdated": { "type": "string", "format": "date" },
    "indices": {
      "type": "object",
      "patternProperties": {
        "^(NIFTY|SENSEX|BANKNIFTY|FINNIFTY|MIDCPNIFTY)$": {
          "type": "object",
          "properties": {
            "lotSize": { "type": "integer" },
            "expiryDay": { "type": "integer", "minimum": 0, "maximum": 6 },
            "strikeStep": { "type": "integer" },
            "entryTime": { "type": "string", "pattern": "^\\d{2}:\\d{2}$" },
            "exitTime": { "type": "string", "pattern": "^\\d{2}:\\d{2}$" },
            "spotToken": { "type": "string" },
            "exchange": { "type": "string", "enum": ["NSE", "BSE"] },
            "optionExchange": { "type": "string", "enum": ["NFO", "BFO"] }
          },
          "required": ["lotSize", "expiryDay", "strikeStep"]
        }
      }
    },
    "api": {
      "type": "object",
      "properties": {
        "baseUrl": { "type": "string", "format": "uri" },
        "timeout": { "type": "integer" },
        "retries": { "type": "integer" }
      }
    },
    "strategy": {
      "type": "object",
      "properties": {
        "ratioShort": { "type": "integer" },
        "ratioLong": { "type": "integer" },
        "stopLossPct": { "type": "number" },
        "vixRange": {
          "type": "array",
          "items": { "type": "number" },
          "minItems": 2,
          "maxItems": 2
        }
      }
    }
  },
  "required": ["version", "lastUpdated", "indices"]
}
```

### 3. `monitors/base.ts`

```typescript
export interface MonitorResult {
  source: string;          // e.g. "nse-contract-specs", "broker-angel-one"
  detectedAt: string;      // ISO date
  changes: ConfigDelta[];  // What changed
  rawData?: unknown;       // The raw fetched data for debugging
}

export interface ConfigDelta {
  path: string;            // JSON path, e.g. "indices.NIFTY.lotSize"
  oldValue: unknown;
  newValue: unknown;
}

export abstract class Monitor {
  abstract name: string;
  abstract run(): Promise<MonitorResult>;
}
```

### 4. `monitors/nse-contract-specs.ts`

This monitor checks NSE for changes to contract specifications.

**Strategy (since NSE doesn't have a clean API):**

Option A — Hardcoded known values with manual override file:
- Maintain a `data/nse-known-specs.json` with current known values
- The monitor checks if this file needs updating (by comparing against a community-maintained source)
- If the user reports a change, they update the specs file manually and the engine re-runs

Option B — Parse NSE website:
- Fetch `https://www.nseindia.com/api/contract-spec?index=derivatives`
- Parse the response for lot size, expiry day
- Compare against cached values
- If different, generate a delta

Implement Option B as primary with Option A as fallback.

The monitor must:
1. Fetch NSE API for contract specs
2. Extract lot sizes for NIFTY, BANKNIFTY, FINNIFTY, SENSEX
3. Compare against cached values in `data/`
4. Return any deltas found

### 5. `monitors/nse-holidays.ts`

- Fetch NSE holiday calendar from `https://www.nseindia.com/api/holiday-master?type=trading`
- Parse trading holidays for the current year
- Compare against cached holiday list
- If new holidays added or dates changed, return delta

### 6. `monitors/broker-angel-one.ts`

- Test SmartAPI connectivity:
  - Ping `https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword` — should return 200 with proper body
  - Check if known header `X-MACaddress` is still accepted
  - Check if `getLastPointPrice` endpoint is still broken
  - Check margin endpoint (`/rest/secure/angelbroking/margin/v1/batch`) returns proper error
- Report any endpoint behavior changes

### 7. `subscribers/registry.ts`

```typescript
export interface SubscriberRepo {
  owner: string;
  repo: string;
  cloneUrl: string;
  config: SubscriberConfig;
  lastChecked: string;
}

export interface SubscriberConfig {
  version: number;
  indices: string[];
  broker: string;
  configPath: string;        // e.g. "config/market-config.json"
  verify: string;            // e.g. "pnpm verify"
  notify: {
    pr: boolean;
    issue: boolean;
  };
}
```

**Discovery mechanisms:**
1. **GitHub topic scan** — Search GitHub for repos tagged with `market-pulse`
2. **Manual registry** — List of known repos in `subscribers.json`
3. **Auto-register** — When engine runs for a repo, it can register itself

### 8. `detectors/diff.ts`

```typescript
export function diffConfigs(
  oldConfig: MarketConfig,
  newConfig: MarketConfig
): ConfigDelta[] {
  // Recursive diff, returns array of changes
  // Each change: { path: "indices.NIFTY.lotSize", oldValue: 65, newValue: 50 }
}

export function generatePatch(deltas: ConfigDelta[]): Record<string, unknown> {
  // Convert deltas into a partial config object for writing
}
```

### 9. `github/client.ts`

```typescript
export class GitHubClient {
  // Wraps gh CLI commands:
  //   gh repo clone <owner/repo> /tmp/market-pulse-work/<repo>
  //   git checkout -b "fix/update-<index>-lot-size"
  //   git add <config-path>
  //   git commit -m "fix: update <index> lot size to <new>"
  //   git push -u origin HEAD
  //   gh pr create --title "fix: update ..." --body "..."
  
  async cloneRepo(subscriber: SubscriberRepo): Promise<string> { ... }
  async createBranch(workDir: string, branchName: string): Promise<void> { ... }
  async commitAndPush(workDir: string, message: string): Promise<void> { ... }
  async createPR(workDir: string, title: string, body: string): Promise<string> { ... }
}
```

### 10. `engine.ts` — Main Entry Point

The engine flow:

```
1. Load subscriber registry (from GitHub topics + subscribers.json)
2. For each subscriber:
   a. Clone repo to /tmp/market-pulse-work/<repo>
   b. Read current market-config.json
   c. Run all monitors
   d. Diff old config vs detected values
   e. If any delta found:
      i.   Update config file
      ii.  Run verify command (e.g. pnpm verify)
      iii. If verify passes: create branch, commit, push, PR
      iv.  If verify fails: create a GitHub Issue instead
   f. Update last-checked timestamp
3. Write updated cache files
4. Log summary
```

### 11. `scripts/bootstrap.ts`

One-time setup script:
1. Search GitHub for repos with `market-pulse` topic
2. For each, check for `.market-pulse.yaml`
3. Add to `subscribers.json`
4. Print summary of discovered repos

### 12. Example subscriber config

`examples/ratio-spread/.market-pulse.yaml`:
```yaml
version: 1
indices:
  - NIFTY
  - SENSEX
broker: angel-one
configPath: config/market-config.json
verify: pnpm verify
notify:
  pr: true
  issue: false
```

### 13. `README.md`

Should include:
- What is market-pulse?
- Architecture diagram (ASCII)
- Quick start: `npx market-pulse init` in your algo repo
- How to subscribe (add `.market-pulse.yaml` + tag repo)
- How monitors work
- How to add a new monitor
- How to add a new broker adapter
- Example PRs generated by the engine
- FAQ

---

## Key design principles

1. **Never push to master** — always branches + PRs. The human reviews.
2. **Verify before PR** — run the repo's verify command. If it fails, file an issue, not a PR.
3. **Cache aggressively** — only re-fetch sources once per day. Write cached values to `data/`.
4. **Idempotent** — running the engine twice with no external changes produces no new PRs.
5. **Language agnostic** — the adapters auto-detect Node/Python/Rust from repo files.
6. **Minimal dependencies** — only `typescript`, `zod`, `dayjs`, `jest`. Keep it lightweight.
7. **12-factor style** — config via env vars for GitHub token, etc.

---

## Verification

Before finishing, run:
```bash
pnpm verify
```

Ensure:
- `tsc --noEmit` passes with 0 errors
- Tests pass (write at least basic tests for monitors + detectors)
- Build succeeds

---

## Output

Write the complete repository to a folder called `market-pulse/` in the current directory. Every file must be fully implemented, not stubbed. The user should be able to `cd market-pulse && pnpm install && pnpm build && pnpm test` and have everything work.
