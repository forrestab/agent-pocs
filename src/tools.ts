import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

const runShellParams = Type.Object({
    command: Type.String({ description: "Command to run" })
});

export const runShellTool: AgentTool<typeof runShellParams> = {
    name: "run_shell",
    label: "Run shell command",
    description: "Runs a read-only shell command. Refuse anything destructive.",
    parameters: runShellParams,
    // In general, its not recommended to include a global try/catch since the framework handles them. The only time youd want to 
    // is to add to the caught error.
    execute: async (_toolCallId, { command }) => {
        const proc = Bun.spawn(["sh", "-c", command], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const text = [stdout, stderr].filter(Boolean).join("\n");

        // `content` is the information sent to the model, `details` is the information used by
        // logs and ui.
        return { content: [{ type: "text", text }], details: { stdout, stderr } };
    }
};

export const allTools: AgentTool[] = [runShellTool];
