import { describe, expect, it } from "vitest";
describe("IRIS 3.0 contracts",()=>{
 it("exposes operational modules",async()=>{const oauth=await import("./oauth-integrations");const control=await import("./agent-control");const scheduler=await import("./workflow-scheduler");expect(typeof oauth.createGoogleOAuthUrl).toBe("function");expect(typeof control.assertAgentMayRun).toBe("function");expect(typeof scheduler.runDueWorkflows).toBe("function");});
 it("contains safe tool contracts",async()=>{const {getAgentTool}=await import("./agent-tools");for(const name of ["calendar.create","external.search","communication.prepare","communication.send"]){const tool=getAgentTool(name);expect(tool).toBeTruthy();expect(tool?.inputSchema).toBeTruthy();}});
});
