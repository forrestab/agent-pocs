import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

async function runCommand(command: string, options: { timeoutMs?: number } = {}): Promise<AgentToolResult<{ stdout: string; stderr: string }>> {
    const proc = Bun.spawn(["sh", "-c", command], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: options.timeoutMs ?? 10_000
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const text = [stdout, stderr].filter(Boolean).join("\n");

    return { content: [{ type: "text", text }], details: { stdout, stderr } };
}

const diskUsageParams = Type.Object({
    path: Type.Optional(
        Type.String({
            description: "Optional path to check. Defaults to all mounted filesystems.",
        }),
    ),
});

export const diskUsageTool: AgentTool<typeof diskUsageParams> = {
    name: "disk_usage",
    label: "Check disk usage",
    description:
        "Returns disk usage for mounted filesystems via `df -h`. " +
        "Use this whenever the user asks about disk space, free space, or storage capacity.",
    parameters: diskUsageParams,
    execute: async (_toolCallId, { path }) => {
        const cmd = path ? `df -h ${JSON.stringify(path)}` : "df -h";
        return runCommand(cmd);
    },
};

const memoryInfoParams = Type.Object({});

export const memoryInfoTool: AgentTool<typeof memoryInfoParams> = {
    name: "memory_info",
    label: "Check memory usage",
    description:
        "Returns RAM and swap usage via `free -h`. " +
        "Use this whenever the user asks about memory, RAM, or swap.",
    parameters: memoryInfoParams,
    execute: async (_toolCallId) => runCommand("free -h"),
};

const systemUptimeParams = Type.Object({});

export const systemUptimeTool: AgentTool<typeof systemUptimeParams> = {
    name: "system_uptime",
    label: "Get system uptime",
    description:
        "Returns system uptime and load averages via `uptime`. " +
        "Use this when the user asks how long the system has been running or about CPU load.",
    parameters: systemUptimeParams,
    execute: async (_toolCallId) => runCommand("uptime"),
};

const serviceStatusParams = Type.Object({
    name: Type.String({
        description: "Service name (e.g., 'docker', 'nginx', 'sshd')",
        pattern: "^[a-zA-Z0-9._@-]+$", // basic sanity
    }),
});

export const serviceStatusTool: AgentTool<typeof serviceStatusParams> = {
    name: "service_status",
    label: "Check systemd service status",
    description:
        "Returns the status of a systemd service via `systemctl status`. " +
        "Use this to check if a specific service is running, stopped, or failed.",
    parameters: serviceStatusParams,
    execute: async (_toolCallId, { name }) => {
        // Validate again at runtime — schema validation is the model's responsibility
        // to follow, but we don't trust it.
        if (!/^[a-zA-Z0-9._@-]+$/.test(name)) {
            const msg = `Invalid service name: ${name}`;
            return { content: [{ type: "text", text: msg }], details: { stdout: "", stderr: msg } };
        }

        return runCommand(`systemctl status ${name} --no-pager`);
    },
};

const readLogParams = Type.Object({
    serviceName: Type.String({
        description: "The service to read logs for (e.g., 'cron', 'nginx', 'sshd').",
        pattern: "^[a-zA-Z0-9._@-]+$",
    }),
    lineCount: Type.Optional(
        Type.Number({ description: "Optional log lines to return. Defaults to 10 lines." })
    )
});

export const readLogTool: AgentTool<typeof readLogParams> = {
    name: "read_log",
    label: "Read the service log",
    description:
        "Returns the specified number of log lines via `journalctl`. " +
        "Use this when the user asks to read logs for a specific service.",
    parameters: readLogParams,
    execute: async (_toolCallId, { serviceName, lineCount }) => {
        if (!/^[a-zA-Z0-9._@-]+$/.test(serviceName)) {
            const msg = `Invalid service name: ${serviceName}`;
            return { content: [{ type: "text", text: msg }], details: { stdout: "", stderr: msg } };
        }
        return runCommand(`journalctl -u ${serviceName} -n ${lineCount ?? 10}`);
    },
};

const runShellParams = Type.Object({
    command: Type.String({ description: "Command to run" })
});

export const runShellTool: AgentTool<typeof runShellParams> = {
    name: "run_shell",
    label: "Run shell command (debug only)",
    description:
        "Run an arbitrary read-only shell command. Only use when no narrower tool fits. " +
        "Refuse anything destructive.",
    parameters: runShellParams,
    // In general, its not recommended to include a global try/catch since the framework handles them. The only time youd want to 
    // is to add to the caught error.
    execute: async (_toolCallId, { command }) => runCommand(command, { timeoutMs: 15_000 }),
};

export function getTools(): AgentTool[] {
    const tools: AgentTool[] = [
        diskUsageTool,
        memoryInfoTool,
        systemUptimeTool,
        serviceStatusTool,
        readLogTool,
    ];

    if (process.env.ENABLE_SHELL_TOOL === "true") {
        tools.push(runShellTool);
    }

    return tools;
}
