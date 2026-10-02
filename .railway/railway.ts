import { defineRailway, github, preserve, project, service } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "live-chat";

export default defineRailway(() => {
  // Must match the existing Railway service name ("live-chat"), or Railway creates a new service.
  const liveChat = service("live-chat", {
    // Keep deploying from GitHub on every push to main.
    source: github("ulu969/live-chat", { branch: "main" }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    // Database setup runs before each deploy and again on start (it's safe to repeat),
    // so the tables exist even if Postgres's private network is slow to come up.
    start: "npm run db:setup && npm start",
    preDeploy: "npm run db:setup",
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    // Keep a single replica: who's online and the event bus live in this process's memory.
    replicas: 1,
    deploy: {
      // Required on Railway's free plan.
      sleepApplication: true,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    env: {
      // Keep the value already set in Railway (a reference to the Postgres service).
      DATABASE_URL: preserve(),
    },
  });
  return project("sparkling-wonder", {
    resources: [liveChat],
  });
});
