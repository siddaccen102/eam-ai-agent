import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({path: ".env.local"});

const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    WORKDAY_BASE_URL: z.string().url(),
    WORKDAY_API_TOKEN: z.string().min(1),
    EAM_BASE_URL: z.string().url(),
    EAM_API_TOKEN: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    WORKDAY_MODE: z.enum(["mock", "live"]).default("mock")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.log("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const env = parsed.data