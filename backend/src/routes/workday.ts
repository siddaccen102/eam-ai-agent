import { Router, Request, Response } from "express";
import { getWorkday, getWorkdayUserByEmail } from "../services/workdayClient";
import {
  IntegrationError,
  integrationErrorHttpStatus,
} from "../errors/integrationError";

const router = Router();

// GET /smoke/user?email=leticia.sales@vopak.com
// Returns a canonical ValidatedUser via the domain-level adapter.
// Backed by mock data while OAuth credentials are still in flight.
router.get("/smoke/user", async (req: Request, res: Response) => {
  const email =
    typeof req.query.email === "string" ? req.query.email : undefined;
  if (!email) {
    return res.status(400).send({
      code: "VALIDATION_ERROR",
      message: "email query parameter is required",
    });
  }

  try {
    const user = await getWorkdayUserByEmail(email);
    return res.send({
      status: "ok",
      provider: "workday",
      user,
    });
  } catch (err) {
    if (err instanceof IntegrationError) {
      return res.status(integrationErrorHttpStatus(err)).send(err.toJSON());
    }
    return res.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Unexpected error during Workday user lookup",
    });
  }
});

router.get("/smoke", async (req: Request, res: Response) => {
  const email =
    typeof req.query.email === "string" ? req.query.email : undefined;
  if (!email) {
    return res.status(400).send({
      code: "VALIDATION_ERROR",
      message: "email query parameter is required",
    });
  }

  try {
    const data = await getWorkday("/people", { primaryWorkEmail: email });
    return res.send({
      status: "ok",
      provider: "workday",
      email,
      data,
    });
  } catch (err) {
    if (err instanceof IntegrationError) {
      return res.status(integrationErrorHttpStatus(err)).send(err.toJSON());
    }
    return res.status(500).send({
      code: "INTERNAL_ERROR",
      message: "Unexpected error during Workday smoke test",
    });
  }
});

export default router;
