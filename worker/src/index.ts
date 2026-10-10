import { callback, login } from "./auth";
import { checkCap } from "./cap";
import { handleCi } from "./ci";
import { serve } from "./download";
import { errorResponse } from "./http";
import { runPrune } from "./prune";
import type { Env } from "./types";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/_ci/") && req.method === "POST") {
      return handleCi(req, env);
    }
    try {
      if (path === "/_auth/login") return await login(req, env);
      if (path === "/_auth/callback") return await callback(req, env);
      return await serve(req, env);
    } catch (e) {
      return errorResponse(e);
    }
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    if (event.cron === "0 * * * *") {
      const state = await checkCap(env, Date.now());
      console.log(
        `cap check: $${state.cost.toFixed(4)} this month, paused=${state.paused}`,
      );
    } else {
      console.log(`prune: removed ${await runPrune(env, Date.now())} objects`);
    }
  },
};
