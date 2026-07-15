# Legacy FastAPI + Vite stack

The previous Python FastAPI backend (`app/`) and Vite React SPA (`frontend/`)
are superseded by the Next.js app in `apps/web`.

Kept for reference only. Prefer:

```bash
docker compose up -d
cd apps/web
npm install
npm run db:apply
npm run dev
```
