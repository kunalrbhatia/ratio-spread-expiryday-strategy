# Using This Template

This repository is designed as a standalone, production-ready algo-trading skeleton for Angel One SmartAPI.

## 1. Creating a New Strategy Repo

1. On GitHub, click **Use this template** > **Create a new repository**.
2. Mark your new repository as **Private** (recommended to safeguard your trading credentials and proprietary strategy logic).
3. Clone your new repository locally:
   ```bash
   git clone https://github.com/<your-username>/<your-repo-name>.git
   cd <your-repo-name>
   pnpm install
   ```
4. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
5. Configure your SmartAPI credentials in `.env` (API key, client code, PIN, and TOTP secret).

---

## 2. Syncing Future Core Skeleton Updates

When core fixes (such as SmartAPI changes, security updates, or bug fixes) are made to this template, you can pull them into your strategy repository without overwriting your custom strategies.

### Step 1: Add the Skeleton Remote
```bash
git remote add skeleton https://github.com/<skeleton-owner>/<skeleton-repo-name>.git
```

### Step 2: Fetch Upstream Updates
```bash
git fetch skeleton
```

### Step 3: Merge Updates
```bash
git merge skeleton/master --allow-unrelated-histories
```
Alternatively, you can cherry-pick specific commit hashes:
```bash
git cherry-pick <commit-hash>
```

### Files to Expect Conflicts In

Because strategies live cleanly separated in `src/strategy/`, conflicts during upstream merges are typically localized to:
- `src/strategy/index.ts` (if new strategy registry entries are registered)
- `package.json` / `pnpm-lock.yaml` (if dependencies are upgraded)
- `data/holidays.json` (if new year holidays were appended)

All other core directories (`src/helpers/`, `src/jobs/`, `src/store/`) should merge cleanly.

---

## 3. Development Workflow

- Always keep `.paper` active or test in paper mode first before deploying real capital.
- Implement strategies under `src/strategy/<YourStrategy>.ts` adhering to the `Strategy` interface.
- Register your strategy in `src/strategy/index.ts`.
- Run verification before committing:
  ```bash
  pnpm verify
  ```
