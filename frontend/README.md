# Frontend (React + Vite + Tailwind)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (the backend must run on :3000; /api is proxied)
npm run build      # production build in dist/
```

Pages in `src/modules/`: `auth` (login, my account), `dashboards`, `users`, `rbac` (approvals, permission matrix),
`audit`, `reports`. The menu hides pages the user lacks permission for; the server enforces permissions anyway.

Other interns add their pages as routes in `src/app/App.jsx` and menu items in `src/app/Layout.jsx`,
and call the backend through `src/services/api.js` (`api('/orders', { method: 'POST', body })`).
Use `useAuth().can('orders.create')` to show or hide buttons.
