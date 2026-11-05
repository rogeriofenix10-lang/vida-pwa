import type { Express } from "express";
import { sdk } from "./sdk";
import { getDb } from "../db";
import { createGoogleOAuthUrl, finishGoogleOAuth } from "../oauth-integrations";
import { createConnectorOAuthUrl, finishConnectorOAuth } from "../oauth-connectors";

export function registerIntegrationOAuthRoutes(app: Express) {
  app.get("/api/integrations/google/:product/start", async (req,res)=>{try{const user=await sdk.authenticateRequest(req);const product=req.params.product as "calendar"|"gmail"|"drive";if(!["calendar","gmail","drive"].includes(product))return res.status(400).send("invalid-product");const db=await getDb();if(!db)return res.status(503).send("database-unavailable");return res.redirect(await createGoogleOAuthUrl(db,user.id,product));}catch(e){return res.status(400).send(e instanceof Error?e.message:"oauth-error");}});
  app.get("/api/integrations/google/callback", async (req,res)=>{try{const code=String(req.query.code||"");const state=String(req.query.state||"");if(!code||!state)return res.status(400).send("missing-oauth-params");const db=await getDb();if(!db)return res.status(503).send("database-unavailable");await finishGoogleOAuth(db,state,code);return res.redirect("/");}catch(e){return res.status(400).send(e instanceof Error?e.message:"oauth-error");}});

  app.get("/api/integrations/:provider/start", async (req,res)=>{
    try {
      const user=await sdk.authenticateRequest(req);
      const provider=req.params.provider as "x"|"tiktok"|"meta";
      if (!["x","tiktok","meta"].includes(provider)) return res.status(400).send("invalid-provider");
      const product = provider === "meta" ? String(req.query.product || "") as "whatsapp"|"instagram"|"facebook" : undefined;
      if (provider === "meta" && !["whatsapp","instagram","facebook"].includes(product || "")) return res.status(400).send("invalid-meta-product");
      const db=await getDb(); if(!db)return res.status(503).send("database-unavailable");
      return res.redirect(await createConnectorOAuthUrl(db,user.id,provider,product));
    } catch(e) { return res.status(400).send(e instanceof Error?e.message:"oauth-error"); }
  });

  app.get("/api/integrations/:provider/callback", async (req,res)=>{
    try {
      const provider=req.params.provider as "x"|"tiktok"|"meta";
      if (!["x","tiktok","meta"].includes(provider)) return res.status(400).send("invalid-provider");
      const code=String(req.query.code||""); const state=String(req.query.state||"");
      if(!code||!state)return res.status(400).send("missing-oauth-params");
      const db=await getDb();if(!db)return res.status(503).send("database-unavailable");
      await finishConnectorOAuth(db,state,code); return res.redirect("/");
    } catch(e) { return res.status(400).send(e instanceof Error?e.message:"oauth-error"); }
  });
}
