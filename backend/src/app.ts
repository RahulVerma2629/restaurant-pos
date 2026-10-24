
import express from "express";
import billingRoutes from "./modules/billing/billing.routes.js";
import cashShiftRoutes from "./modules/billing/cash-shift.routes.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/billing", billingRoutes);
app.use("/api/cash-shifts", cashShiftRoutes);
export default app;
