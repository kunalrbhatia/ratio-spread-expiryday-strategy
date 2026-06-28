# RatioSpread Expiry Algo — AI Assistant Instructions

## Pre-Approved Commands & settings.json Rule
- **Command Approvals**: Before proposing/running any shell command, always inspect [settings.json](file:///C:/Users/Kunal/Desktop/hobby-projects/ratiospread-expiry-strategy/settings.json) in the workspace root to see if the command prefix or exact command is listed in `allowed_commands`.
- **Bypass Prompting**: If the command is listed, run it directly without asking or explaining.
- **Update Settings**: If the user instructs to persist a command or option to `settings.json`, update the `allowed_commands` array in [settings.json](file:///C:/Users/Kunal/Desktop/hobby-projects/ratiospread-expiry-strategy/settings.json) immediately.

## Verification & Commands
- Verification: Code must pass `pnpm verify` (typecheck, lint, test, build).
- Environment: Timezone must be `Asia/Kolkata` (IST).
- State: Positions in `data/positions.json`, config in `data/config.json`, paper mode via `.paper` file.
