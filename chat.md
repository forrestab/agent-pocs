# agent research

## User

Can you help me figure out the terminology for what I would call the result of using pi-core and pi-sdk with specialized plugins, almost like openclaw but not as general

## Claude

To help you nail down the right terminology, I need a bit more context — I'm not familiar with "pi-core," "pi-sdk," or "openclaw" as established products, so they might be internal to your project or quite niche.

A few questions that would help:

What domain are you working in? (robotics, fintech, dev tools, IoT, something else?)

What does the combination actually *do* for users — is it a framework, a runtime, a platform, an SDK extension, a toolkit?

When you say "not as general" as openclaw, what's the scope you're narrowing to — a specific industry, a specific task type, a specific hardware target?

Common terminology patterns for "core + SDK + specialized plugins" setups include things like *vertical platform*, *domain-specific runtime*, *opinionated framework*, *application stack*, or *solution kit* — but the right word really depends on what it does and who it's for.

## User

The pi-mono project,  https://github.com/badlogic/pi-mono/tree/main/packages and the openclaw project -  https://github.com/openclaw/openclaw

## Claude

Let me take a look at both projects to understand what you're working with.

The page didn't render the package list — let me check the README for both projects directly.

Good, now I have the picture. Let me also check OpenClaw to see what it's doing with the pi SDK.

Now I have a clear picture. Here's the lay of the land:

**Pi-mono** is an agent toolkit — `pi-ai` (LLM API), `pi-agent-core` (agent loop/runtime), `pi-coding-agent` (coding agent + SDK + extensions/skills/packages), plus TUI/web-UI libraries. It's deliberately minimal and extensible.

**OpenClaw** is what you get when you take that SDK, embed `createAgentSession()` directly, and bolt on messaging-gateway-specific tools (Discord/Telegram/Slack/WhatsApp action tools, sandbox replacements, channel adapters). It's a personal-assistant product built *on top of* pi.

So what you're describing — pi-core + pi-sdk + specialized plugins, "almost like OpenClaw but not as general" — is a narrower-scope version of the same architectural pattern. Here are the terms that fit, ordered roughly from most to least precise:

**Embedded agent** — the term pi's own docs use ("embedded approach," `runEmbeddedPiAgent`). Captures the key architectural fact: you're importing the SDK in-process rather than spawning pi as a CLI/RPC. This is probably the most accurate technical label.

**Vertical agent** or **domain-specific agent** — emphasizes "not as general as OpenClaw." OpenClaw is a general personal assistant across 20+ channels; yours is scoped to one purpose.

**Pi-based agent** or **pi distribution** — by analogy with Linux distros: same kernel, different userland. OpenClaw, PiClaw, and your thing are all "pi distributions" with different opinions baked in.

**Agent application** (vs. agent framework) — pi is the framework, OpenClaw and your thing are *applications* built with it. Clean separation but a bit generic.

**Specialized agent host** or **agent harness** — "host" and "harness" both convey "the thing that wraps the SDK and gives it a job."

If I had to pick one: **"a pi-based embedded agent for [your domain]"** is the most descriptive, and **"a vertical OpenClaw"** is the most evocative shorthand if your audience already knows OpenClaw.

What's the actual scope of your thing? If you tell me what it specializes in, I can suggest something more specific than these generic labels.

## User

I was wrong, I want to build something using pi-ai and pi-agent-core. Honestly just trying to learn how it works, say for instance as an assistant. Does it literally just stay running waiting for requests? Stuff like this and I’m thinking about building a small assistant to help maybe manage my homelab or something to that effect

## Claude

Good pivot — `pi-ai` + `pi-agent-core` is the right layer for learning. You skip all the coding-agent opinions (sessions, file tools, extensions) and just deal with the raw agent loop. Let me answer the lifecycle question first since that's the conceptual block.

**No, it doesn't sit running waiting for requests by default.** `pi-agent-core` is a library, not a daemon. The `Agent` class is just an object you instantiate in *your* program. When you call `agent.complete(messages)` (or whatever the equivalent is), it does one full agent loop: send to LLM → if the model wants tools, execute them → feed results back → repeat until the model produces a final answer → return. Then your code keeps running, or exits.

So "always-on assistant" is something *you* build around it. The pattern looks like:

- A **CLI one-shot** — script runs, asks one question, prints answer, exits. Good for cron jobs ("check disk space across the homelab every hour").
- A **REPL** — your program loops on stdin, calls the agent each turn, keeps a `messages[]` array in memory for history. Dies when you Ctrl-C.
- A **long-running service** — an HTTP server, a Telegram/Discord bot, an MQTT subscriber. *This* is the one that "stays running waiting for requests." You write the listener; when a message comes in, you call the agent. OpenClaw is exactly this pattern at a large scale — a gateway that listens on 20+ messaging channels and hands each incoming message to an embedded pi agent.

The agent itself is stateless between calls. Conversation memory is just a `messages` array you choose to persist (file, sqlite, Redis — whatever) and pass back in next time.

For a homelab assistant, the natural shape is the third one. Concretely: a small Node service that exposes either a Telegram bot or a simple HTTP endpoint, wires up `pi-ai` for LLM calls and `pi-agent-core` for the loop, and gives the agent a handful of tools you write yourself — `ssh_exec`, `docker_ps`, `check_service`, `read_log`, maybe `restart_container`. The tools are just async TS functions with a JSON schema; the agent core handles the "model asks for tool, we run it, we feed result back" dance.

A good learning progression:

1. **One-shot, no tools** — just `pi-ai` directly. Send a prompt, print the response. Confirms your provider/auth works.
2. **One-shot with one tool** — add `pi-agent-core`, give it a `get_time` or `read_file` tool. Watch the loop happen.
3. **REPL with history** — same thing but loop on stdin and keep messages around.
4. **Persistent service** — wrap it in a Telegram bot or HTTP endpoint. Now it "stays running."
5. **Real homelab tools** — swap toy tools for `ssh_exec`, Docker API calls, Proxmox API, whatever your lab runs.

One caveat: giving an LLM a tool that runs shell commands on your homelab is a real footgun. Start with read-only tools (status, logs, metrics) before anything that writes or restarts. Even better, gate destructive tools behind a confirmation step where the agent has to tell you what it's about to do and you reply "yes" before it executes.

Want me to sketch the actual code for step 1 or 2 so you have a concrete starting point?

## User

Oh I see, for some reason I was thinking it was something overly complicated. Yeah I’d be interested in what you come up with

## Claude

Good — once it clicks that it's just a library, the mystery evaporates. Let me check the actual API shape so the code is accurate, not made up.

I have the API confirmed. Let me write you a clean walkthrough — three progressive files, each one doing exactly one new thing. I'll keep them simple enough that you can read and modify them.

**Setup**

```bash
mkdir homelab-agent && cd homelab-agent
npm init -y
npm install @mariozechner/pi-ai @mariozechner/pi-agent-core typebox
npm install -D typescript @types/node tsx
export ANTHROPIC_API_KEY=sk-ant-...
```

Add `"type": "module"` to your `package.json`.

---

**Step 1 — `01-basic.ts`: just a one-shot LLM call, no agent loop yet**

```ts
import { getModel, completeSimple } from "@mariozechner/pi-ai";

const model = getModel("anthropic", "claude-sonnet-4-5-20250929");

const response = await completeSimple(model, {
  systemPrompt: "You are a helpful assistant.",
  messages: [
    { role: "user", content: "What is a homelab in one sentence?", timestamp: Date.now() }
  ],
});

for (const block of response.content) {
  if (block.type === "text") console.log(block.text);
}
```

Run with `npx tsx 01-basic.ts`. This is just `pi-ai` — no agent, no tools, no loop. Confirms your auth works.

---

**Step 2 — `02-tools.ts`: agent with a real tool**

This is where the loop happens. We give the agent a `disk_usage` tool. Watch what happens: the model decides to call it, `pi-agent-core` runs it, feeds the result back, and the model summarizes.

```ts
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);

const diskUsageTool: AgentTool = {
  name: "disk_usage",
  label: "Check disk usage",
  description: "Returns disk usage on the local machine via `df -h`.",
  parameters: Type.Object({
    path: Type.Optional(Type.String({ description: "Optional path, defaults to /" })),
  }),
  execute: async ({ path }) => {
    const { stdout } = await execAsync(`df -h ${path ?? "/"}`);
    return { output: stdout };
  },
};

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a homelab assistant. Use tools to check the system when asked.",
    model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
    tools: [diskUsageTool],
    thinkingLevel: "off",
    messages: [],
  },
  streamFn: streamSimple,
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "agent_end") process.stdout.write("\n");
});

await agent.prompt("How full is my main drive?");
```

When you run this, the trace is roughly: model → "I should call disk_usage" → tool runs → output goes back → model writes a human summary. That's the entire agent loop. Everything more sophisticated is just *more tools* and *more context management*.

---

**Step 3 — `03-repl.ts`: keep the agent alive across turns**

The Agent holds its own message history in `agent.state.messages`, so to make it conversational you just keep calling `prompt()` on the same instance.

```ts
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as readline from "node:readline/promises";
const execAsync = promisify(exec);

const runShellTool: AgentTool = {
  name: "run_shell",
  label: "Run shell command",
  description: "Runs a read-only shell command. Refuse anything destructive.",
  parameters: Type.Object({
    command: Type.String({ description: "Command to run" }),
  }),
  execute: async ({ command }) => {
    const { stdout, stderr } = await execAsync(command);
    return { stdout, stderr };
  },
};

const agent = new Agent({
  initialState: {
    systemPrompt:
      "You are a homelab assistant. Use run_shell for read-only diagnostics " +
      "(df, free, uptime, docker ps, systemctl status, journalctl, etc). " +
      "Never run anything that modifies state without confirming with the user first.",
    model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
    tools: [runShellTool],
    thinkingLevel: "off",
    messages: [],
  },
  streamFn: streamSimple,
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("homelab-agent ready. Ctrl-C to quit.\n");

while (true) {
  const input = await rl.question("\nyou> ");
  if (!input.trim()) continue;
  process.stdout.write("agent> ");
  await agent.prompt(input);
}
```

That's a working assistant. It remembers the conversation, can call shell commands, and stays running. From here, the path forward is obvious — replace `run_shell` with narrower, safer tools you write specifically for your lab:

- `docker_ps`, `docker_logs(container, lines)`, `docker_restart(container)`
- `service_status(name)` wrapping `systemctl is-active`
- `proxmox_vm_list()` hitting the Proxmox API
- `check_url(url)` for uptime checks

Each one is just an `AgentTool` object with a `parameters` schema and an `execute` function. The schema is what the model sees; the execute is what actually runs.

**Two things worth knowing as you grow this:**

The `messages` array on `agent.state` is plain JSON — you can serialize it to a file at the end of a session and reload it on startup if you want persistence across restarts. That's all "session storage" really is at this layer.

When you're ready to make it "always on" (Telegram bot, HTTP server, MQTT subscriber), the agent code doesn't change — you just replace the readline loop with whatever event source you want. Each incoming message becomes an `agent.prompt()` call. That's the pattern OpenClaw uses; just at a much bigger scale.

Want me to sketch the Telegram bot version next, or get into the safety/confirmation pattern for destructive tools?

## User

Step 2 doesn’t seem to accept any user input, does this mean assumes to run the only tool it has based on the system prompt?

## Claude

No, the user input is there — it's just hardcoded as the literal string `"How full is my main drive?"` on the last line: `await agent.prompt("How full is my main drive?")`. That's the user message for that one-shot run. Change the string, you get a different question.

Step 2 is intentionally a one-shot — it runs once, the agent loop completes (model → tool call → tool result → model summary → done), and the program exits. There's no `readline`, no loop, no waiting for stdin. That's why it feels like it "just runs the tool" — because the prompt I baked in happens to need that tool. If you change the prompt to `"What's 2+2?"` it'll answer without calling the tool at all. If you change it to `"What time is it?"` and the tool can't help, it'll just say it doesn't know.

The system prompt doesn't *force* tool use — it just tells the model the tools exist and when they're appropriate. The model decides per-turn whether to call them based on what the user asked.

Step 3 is where input becomes interactive, because that's where I added the readline loop. So the progression is really:

- Step 1: one-shot, no tools — proves LLM works
- Step 2: one-shot, with a tool — proves the agent loop works
- Step 3: interactive, with a tool — proves you can hold a conversation

If you want Step 2 to take input from the command line instead of being hardcoded, swap the last line for:

```ts
const userInput = process.argv.slice(2).join(" ") || "How full is my main drive?";
await agent.prompt(userInput);
```

Then `npx tsx 02-tools.ts "what's my uptime?"` works — though that one will fail since `disk_usage` can't answer it, which is actually a useful thing to observe.

## User

I see, I didn’t realize I needed to expand your code blocks to see all the code

## Claude

Ha, that explains it. Mobile code blocks scroll horizontally and it's easy to miss the last line, especially when the interesting bit is buried at the bottom. Glad it makes sense now.

Want to keep going? Good next steps depending on what you're curious about:

- **Telegram bot wrapper** so it's actually "always on" and you can poke it from your phone
- **Persisting messages to disk** so conversations survive restarts
- **Multiple narrow tools** for your homelab (docker_ps, service_status, etc.) instead of one shell tool
- **Confirmation pattern** for destructive actions — model proposes, you approve, then it runs

Or just keep tinkering with what you have and come back when you hit something.

## User

I am interested in the always on via a chat interface, but could you use discord instead?

## Claude

Yeah, Discord works great for this — arguably better than Telegram for a homelab assistant since you can have channels for different concerns (alerts, queries, logs) and it's trivial to run from your phone or desktop.

Let me check the current discord.js API so the code is right.

Got what I need. Here's the plan: a single Discord bot file that wraps the agent we already built. Per-user conversation memory (so different people in your server get separate threads), bot only responds when @mentioned (so it doesn't try to answer every message in the channel), and a typing indicator while the agent thinks.

**One-time Discord setup**

1. Go to <https://discord.com/developers/applications>, click **New Application**, name it.
2. Sidebar → **Bot** → **Reset Token**, copy it (this is your `DISCORD_TOKEN`).
3. Same Bot page → scroll to **Privileged Gateway Intents** → enable **MESSAGE CONTENT INTENT**. Save.
4. Sidebar → **OAuth2** → **URL Generator**. Tick `bot` under scopes, then `Send Messages` + `Read Message History` + `View Channels` under bot permissions. Copy the generated URL, open it in a browser, invite the bot to your server.

**Install**

```bash
npm install discord.js dotenv
```

Create `.env`:

```
DISCORD_TOKEN=your_bot_token_here
ANTHROPIC_API_KEY=sk-ant-...
```

**`bot.ts`**

```ts
import "dotenv/config";
import { Client, GatewayIntentBits, Events, Message } from "discord.js";
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// --- Tool: read-only shell access ---
const runShellTool: AgentTool = {
  name: "run_shell",
  label: "Run shell command",
  description:
    "Runs a read-only diagnostic shell command (df, free, uptime, " +
    "docker ps, systemctl status, journalctl, etc). Refuse anything destructive.",
  parameters: Type.Object({
    command: Type.String({ description: "Command to run" }),
  }),
  execute: async ({ command }) => {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 15_000 });
      return { stdout, stderr };
    } catch (err: any) {
      return { error: err.message, stdout: err.stdout, stderr: err.stderr };
    }
  },
};

// --- One agent per Discord user, kept in memory ---
const agents = new Map<string, Agent>();

function getAgentFor(userId: string): Agent {
  let agent = agents.get(userId);
  if (agent) return agent;

  agent = new Agent({
    initialState: {
      systemPrompt:
        "You are a homelab assistant running as a Discord bot. " +
        "Use run_shell for read-only diagnostics only. " +
        "Never run anything that modifies state without confirming first. " +
        "Keep responses concise — Discord messages are read on phones.",
      model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
      tools: [runShellTool],
      thinkingLevel: "off",
      messages: [],
    },
    streamFn: streamSimple,
  });

  agents.set(userId, agent);
  return agent;
}

// --- Discord client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore the bot's own messages
  if (message.author.bot) return;

  // In guilds, only respond when mentioned. In DMs, respond to everything.
  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user!);
  if (!isDM && !isMentioned) return;

  // Strip the @mention from the message text
  const userText = message.content
    .replace(`<@${client.user!.id}>`, "")
    .trim();
  if (!userText) return;

  // Show typing indicator while the agent works
  const typingInterval = setInterval(() => {
    message.channel.sendTyping().catch(() => {});
  }, 8_000);
  message.channel.sendTyping().catch(() => {});

  // Collect the agent's text output for this turn
  const agent = getAgentFor(message.author.id);
  let buffer = "";

  const unsubscribe = agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      buffer += event.assistantMessageEvent.delta;
    }
  });

  try {
    await agent.prompt(userText);
  } catch (err: any) {
    buffer = `error: ${err.message}`;
  } finally {
    unsubscribe();
    clearInterval(typingInterval);
  }

  // Discord caps messages at 2000 chars — split if needed
  const reply = buffer.trim() || "(no response)";
  for (let i = 0; i < reply.length; i += 1900) {
    await message.reply(reply.slice(i, i + 1900));
  }
});

client.login(process.env.DISCORD_TOKEN);
```

Run it: `npx tsx bot.ts`

**Usage**

In your server, mention the bot: `@homelab-bot how full is my main drive?` In a DM with the bot, just type normally.

**What's actually happening**

Each Discord user gets their own `Agent` instance stored in a Map, so your conversation history is separate from anyone else's in your server. The agent's `messages` array on `agent.state.messages` accumulates automatically — that's the conversation memory. It lives only in process memory, so a restart wipes it. Persisting that array to a JSON file on shutdown and loading it on startup is the obvious next step if you want it.

The typing indicator pattern is a Discord nicety — `sendTyping()` only lasts about 10 seconds, so you re-fire it every 8s while the agent works. Without it, the bot would just go silent for however long the LLM takes.

**A few things to be careful about**

The bot is running on whatever machine you start it on, so `run_shell` runs commands on *that* host. If you want to query other machines in your homelab, either run the bot on each one (different bots, different tokens), or give it an `ssh_exec` tool that takes a hostname and command and shells out via SSH using a key you've set up.

Anyone in a server the bot is in can mention it and run commands. Lock this down by gating on `message.author.id` — only respond if the user ID matches yours. Add this near the top of the handler:

```ts
const ALLOWED_USERS = new Set([process.env.MY_DISCORD_USER_ID!]);
if (!ALLOWED_USERS.has(message.author.id)) return;
```

The model can issue arbitrary shell commands. Even with "read-only" in the system prompt, it's not a guarantee. If you want real safety, replace `run_shell` with a small set of narrow tools (`disk_usage`, `service_status`, `docker_ps`, `recent_logs`) where each one runs a fixed command with validated arguments. The model loses flexibility but gains predictability — a good trade for a homelab bot you might leave running.

Want me to sketch the narrow-tools version, or the SSH-to-other-hosts version, or persistence?

## User

I’m interested in a couple of things: 1. How would it work if I ran this agent in a container in my homelab? Do I just need to make sure it can access homelab services from inside? 2. How do skills come into the picture?

## Claude

Good questions, both get at real architectural decisions. Let me take them in order.

**1. Running the agent in a container**

Yes, basically. The container is just a Linux process — from its point of view, "the homelab" is whatever it can reach over the network or via mounted paths. Three layers to think about:

*Network reachability.* If your services are on the same Docker host, put the bot on the same Docker network as them and it can reach them by container name (`http://prometheus:9090`, `http://portainer:9000/api`, etc.). If your services are on other machines (Proxmox VMs, separate hosts, bare metal), the bot just needs network routing to them — usually trivial on a flat home network. For services exposed via a reverse proxy with hostnames (`grafana.lan`, `unifi.lan`), make sure the container's DNS resolves those, which usually means pointing the container at your local DNS server.

*Filesystem access.* `run_shell` and friends only see what's inside the container. If you want the agent to read host logs, mount them in: `-v /var/log:/host/var/log:ro`. If you want it to manage Docker itself, mount the socket: `-v /var/run/docker.sock:/var/run/docker.sock` — though that's effectively root on the host, so be deliberate about it. For SSHing to other machines, mount an SSH key: `-v ~/.ssh/homelab_key:/root/.ssh/id_rsa:ro`.

*Credentials.* API keys go in environment variables, not baked into the image. A `.env` file plus `--env-file .env` or Docker secrets if you're using Swarm/Compose.

A minimal `Dockerfile`:

```dockerfile
FROM node:22-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npx", "tsx", "bot.ts"]
```

And `docker-compose.yml`:

```yaml
services:
  homelab-agent:
    build: .
    restart: unless-stopped
    env_file: .env
    networks:
      - homelab
    volumes:
      - ./data:/app/data           # for persisted conversations
      - ~/.ssh/homelab_key:/root/.ssh/id_rsa:ro
    # Add this only if you want it to manage Docker on the host:
    # - /var/run/docker.sock:/var/run/docker.sock

networks:
  homelab:
    external: true                  # join an existing network where your services live
```

The "homelab" network thing matters: if you already have a docker network where your other services run, joining it lets the bot reach them by name. If not, you can put everything on a new network in the same compose file.

A few practical things that bite people:

The agent is stateless across restarts unless you persist `agent.state.messages` somewhere. With a container that auto-restarts, that's more visible. Easiest fix: serialize each user's message array to `/app/data/<userId>.json` after each prompt, load on agent creation.

If `run_shell` is in the toolset, "the shell" now means the container's shell. `df -h` shows the container's filesystem, not the host's. Either bind-mount the paths you care about read-only, or replace `run_shell` with tools that explicitly SSH to the right place.

LLM API calls go out to the internet, so the container needs egress. Almost always fine, just worth knowing if you have strict firewall rules.

**2. How skills come into the picture**

Short answer: skills are a `pi-coding-agent` feature, not a `pi-agent-core` feature. At the layer we're working at, they don't really exist — but the pattern they implement is something you'd build yourself if you needed it.

Here's the distinction. A **tool** is a function the model can call. A **skill** is a markdown file with instructions on how to do a class of task, optionally with tools and resources bundled alongside. Skills get loaded into context only when the model decides they're relevant — that's the "progressive disclosure" pi talks about. The model sees a short list like "skills available: docx, pdf, postgres-debugging" and can pull the full skill content in when it needs it, instead of having every skill's instructions burning tokens upfront.

`pi-coding-agent` ships with a skills loader that watches `~/.pi/agent/skills/` (and project-local `.pi/skills/`), exposes them to the model, and handles loading. `pi-agent-core` doesn't have any of that — it's just the loop and tools.

For your homelab agent, you have three options:

*Skip skills entirely.* For a bot with 5–10 narrow tools, you don't need them. Just describe each tool clearly in its `description` field. Skills become valuable when you have lots of specialized knowledge that's situational — "how to debug a Proxmox VM that won't start," "the runbook for when Pi-hole stops resolving" — stuff that's too long to put in the system prompt but too specific to need every turn.

*Roll your own lightweight version.* Add a `list_runbooks` tool that returns titles + summaries from a `runbooks/` directory, and a `read_runbook` tool that reads the full markdown. The model learns "if the user asks about something I might have a runbook for, list them and read the relevant one." This is essentially what skills are, just hand-rolled. Maybe 30 lines of code.

*Move up to `pi-coding-agent`.* If you find yourself building a lot of skills-like infrastructure, the higher-level package gives you skills, sessions, extensions, and the package system for free. The trade-off is more opinions about how things work — you're moving from "library you compose" to "agent you configure." For homelab work, this might genuinely be the right call once your assistant is doing more than 3-4 things.

The honest recommendation: start without skills, build narrow tools, and only add a skills-like system if you notice yourself wanting to give the agent long contextual instructions about specific subsystems ("when working with Proxmox, always use the API not pvesh because...", "Pi-hole config lives at..."). When that itch shows up, you'll know what shape your skills should take, and you can either roll a small version or graduate to `pi-coding-agent`.

Want me to sketch the persistence-on-disk piece for the bot, or the hand-rolled runbooks tool, or move toward narrow tools for specific homelab services?

## User

Can I use my codex subscription with pi-agent-core?

## Claude

Let me verify the current state of OpenAI Codex (ChatGPT subscription) auth in pi-ai, since this is something that's been changing.

Yes, you can. The pi-ai docs explicitly list "OpenAI Codex (ChatGPT Plus/Pro subscription, requires OAuth)" as a supported provider, and OpenClaw's docs confirm the route works through pi-ai by selecting the `openai-codex/*` model prefix instead of `openai/*`. The login flow is OAuth via browser, same mechanism the official Codex CLI uses.

That said — I'd push back gently on this for your homelab bot specifically.

**The mismatch**

Your ChatGPT/Codex subscription is rate-limited by *messages over time windows*, scaled to "real coding sessions." Plus gets you a modest budget; Pro is generous but still finite. A homelab assistant tends to be the opposite usage shape — bursty single questions, often with tool-call loops that fire 3-5 model calls per "message" you send. One "@bot how's docker doing" might be 4 turns under the hood. You'll burn the quota faster than you'd expect, and when you hit the limit the bot just stops working until the window resets. There's no graceful fallback unless you build one.

The Codex subscription also assumes a coding context — the models are tuned and the rate limits are sized for code-writing sessions, not for "always-on assistant pinged sporadically across the day." It works, but you're using the subscription against its grain.

**What I'd actually recommend**

For a homelab bot, the Anthropic API key with Claude Sonnet is a better fit. Pay-as-you-go means no rate-limit cliff, and a homelab assistant making maybe 50–200 short tool-using turns per day will cost you single-digit dollars per month. If you're already paying $20–200/month for ChatGPT, the irony is that running a personal bot off a metered API key is *cheaper* than trying to repurpose the subscription for it.

If you want to use what you're already paying for, a saner pattern is: keep Codex for actual coding work in the CLI/IDE where the rate limits make sense, and run the homelab bot on whatever's cheapest per-token. You can also run it off a local model via Ollama or vLLM — pi-ai supports any OpenAI-compatible endpoint, so a Llama or Qwen model on your homelab GPU gives you "free" inference, just slower and dumber.

**If you want to do it anyway**

The mechanics, based on pi-ai's docs: you'd run an OAuth login flow once to get a token cached locally, then use a model ID like `openai-codex/gpt-5.5` (or whatever current Codex model name pi-ai exposes) instead of `anthropic/claude-sonnet-4-5-...`. Inside a Docker container this gets awkward because the OAuth flow wants a browser callback — there's a device-code flow option for headless setups, but you'd want to do the login on your laptop first, then mount the credentials file into the container.

What's your actual constraint here — trying to avoid paying for another API, or specifically wanting to use Codex models? If it's the former, the Anthropic key is probably the path of least resistance. If it's the latter, the OAuth path works but plan for the rate-limit reality.

## User

Just seeing what’s available, I also thought about using free models from openrouter but I’d have to be careful with what’s sent out to the llm

## Claude

Yeah, that's exactly the right instinct — and OpenRouter free models are absolutely viable for a homelab bot, but the data exposure question is real. Let me break it down honestly.

**What "free" means on OpenRouter**

The free tier models (typically marked with `:free` suffix, things like `meta-llama/llama-3.3-70b-instruct:free`, various Qwen and DeepSeek models, etc.) are free because the underlying providers have struck a deal where they get to use your prompts and completions for training or research in exchange for not charging. OpenRouter is upfront about this — the free endpoints route to providers with logging/training enabled. Some models are hosted by the model authors themselves (Meta, Mistral); others go through third parties like Chutes, Together, or DeepInfra running them on free tiers.

So the threat model is: every prompt your bot sends — including tool *outputs* fed back to the model — gets logged and potentially used by whoever's hosting that endpoint. For a homelab bot, the concerning content is in the tool results: hostnames, internal IPs, container names, port numbers, error messages from your services, log lines, file paths, possibly snippets of config. That's not catastrophic but it's a non-zero leak of your network topology and operational details.

**What's actually risky vs. fine**

Mostly fine to send: the system prompt (generic), the user's natural-language questions, summaries the model produces. None of this is sensitive on its own.

Worth being careful about: tool outputs that include hostnames/IPs (`192.168.1.50`, `prometheus.lan`), service names that hint at what you run (`vaultwarden`, `paperless-ngx`), versions and patch levels (useful for someone profiling for vulns), authentication errors that reveal usernames, file paths that reveal directory structure.

Genuinely dangerous: API tokens, passwords, SSH keys, or session cookies that accidentally end up in tool output. This is the "don't pipe `env` or `cat .env` to the model" rule.

**Practical mitigations if you go this route**

The cheapest mitigation is narrow tools instead of `run_shell`. With `run_shell`, the model gets to see whatever output any command produces, and you have to trust both the model and yourself to keep secrets out. With purpose-built tools like `disk_usage`, `service_status(name)`, `docker_ps`, you control exactly what fields go into the response — you can return `{state: "running", uptime: "3d"}` without ever exposing IPs or paths.

The next layer is a sanitizing wrapper. Before any tool result is returned to the agent, run it through a redaction step: regex out IPs (`/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/`), known internal hostnames, anything matching token patterns. Imperfect but cuts the obvious leaks. You can do this in `pi-agent-core` via the `afterToolCall` hook — it lets you inspect and modify tool results before they go back to the model.

For paid OpenRouter models (not free), they have a `:nitro` and standard tier where you can set data policy preferences in your account — restricting to providers that don't log. Worth knowing exists, but defeats the "free" point.

**What I'd actually suggest**

If cost-avoidance is the goal, the order I'd consider:

A local model via Ollama, if you have a machine with even modest GPU (or enough RAM for CPU inference of something like Qwen 2.5 7B). Pi-ai supports any OpenAI-compatible endpoint, so `http://ollama:11434/v1` works fine. Quality is noticeably worse than frontier models, but for "run df, summarize the output" it's adequate, and nothing leaves your network. This is the actually-private option.

OpenRouter free tier with narrow tools and a redaction hook. Quality is much better than local models, and the leak surface is small if you're disciplined about tool design. Reasonable for a hobby project where the "secret" is "I run Plex and Pi-hole" rather than anything actually sensitive.

A small Anthropic or OpenAI API budget with pay-as-you-go. For a personal bot, you're realistically looking at a few dollars a month. Sometimes the answer is just "this isn't actually expensive."

The middle path most homelabbers land on is: local model for routine queries, paid API key as a fallback for harder questions. Pi-ai makes this easy — you just call `getModel()` with a different provider/model based on the prompt or a user flag.

What's your homelab GPU situation, if any? That heavily influences which of these makes sense for you.

## User

My homelab only has a 10th gen intel cpu and 32gb of ram

## Claude

That's actually a workable setup for small local models on CPU — not great, but workable. Let me give you the realistic picture.

**What you can run on that hardware**

A 10th-gen Intel with 32GB RAM, no GPU, means CPU inference via something like Ollama or llama.cpp. The constraint isn't really RAM — 32GB is plenty for any model you'd want to run on CPU — it's tokens-per-second. CPU inference is slow.

Rough expectations for what you'd actually run:

- **Qwen 2.5 7B** (or 3B for faster, dumber responses) — quantized to Q4, this'll run at maybe 5-10 tokens/sec on your CPU. Usable for short responses, painful for long ones. Tool-calling support is decent.
- **Llama 3.2 3B** — faster, around 10-15 tok/sec, weaker reasoning but fine for "summarize this df output."
- **Phi-3.5 mini** (3.8B) — Microsoft's small model, surprisingly capable for size, similar speed.

A typical homelab bot interaction is maybe 200-500 output tokens. At 7 tok/sec, that's 30-70 seconds per response. For a Discord bot where you @mention it and walk away, that's tolerable. For something snappier, frustrating.

**The real catch: tool calling on small models**

Frontier models (Claude, GPT-4) handle tool calling reliably. Small local models do not. You'll see them hallucinate tool names, malform JSON arguments, fail to chain tool calls correctly, or just answer from imagination instead of calling the tool. Qwen 2.5 7B is probably the best of the small open models at this and it's still noticeably worse than even GPT-4o-mini.

In practice this means: the bot will sometimes confidently make stuff up about your homelab instead of actually checking, and you'll have to learn its quirks. For a learning project this is fine and even instructive. For "I want a reliable assistant" it's a setup for frustration.

**What I'd actually do in your shoes**

Given the hardware reality, the honest recommendation is to **not run the model locally** and instead use a paid API for the bot itself. Here's the math: a homelab bot you ping casually, maybe 20-50 times a day, with short tool-using turns, on Claude Sonnet, is roughly $2-5/month. On Haiku it's under a dollar. That's less than the electricity cost of pegging your CPU on inference.

Use the local hardware for what it's actually good at — running the bot process itself, the Docker stack, your services. The LLM call goes out over the internet to a cheap API, you get frontier-quality reasoning and tool use, and your homelab stays responsive for the actual workloads.

If the goal is privacy/sovereignty, that's a different conversation and local models are the answer despite the speed. But if the goal is cost-avoidance, paid APIs at homelab-bot-volume are functionally free.

**The middle path worth considering**

OpenRouter free tier with a good model like `deepseek/deepseek-chat-v3` or `qwen/qwen-2.5-72b-instruct:free` — you get frontier-ish quality remotely, no hardware burden, and the data exposure concerns we discussed. For a homelab where the "secrets" are "I run Jellyfin and Sonarr," this is a perfectly reasonable trade. Add a small redaction wrapper for IPs and hostnames if you want to be tidy about it.

If you want to try local anyway just to see, Ollama is genuinely 5 minutes to set up:

```bash
docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
docker exec -it ollama ollama pull qwen2.5:7b
```

Then point pi-ai at `http://localhost:11434/v1` with model `qwen2.5:7b` and try it. Worth doing once just to feel the difference — it's the kind of thing where the abstract trade-offs become visceral after one slow response.

What's your actual goal here, learning-wise? If it's "understand how agents work end-to-end," any of these paths gets you there. If it's "have a useful homelab bot," the paid API is the path of least friction.

## User

My goal is to learn how agents work for work and maybe end up with a decent homelab bot at the same time. I may consider just using a a cheap subscription to codex or even open router go, just for playing around until it becomes production and switch to an api pricing model, I’m not sure. The nice thing is I can use the subscription for developing and testing

## Claude

That's a solid plan, and the reasoning is sound — using a subscription for the messy exploratory phase where you're going to burn a lot of tokens on retries, broken tool schemas, and "wait why did it do that" debugging is genuinely how this stuff gets learned. Per-token billing during learning feels stressful in a way that flat-rate doesn't, even when the actual cost is small.

A few thoughts on making this work well for your stated goal of "learn agents for work":

**The subscription-then-API transition is real, and worth designing for from day one**

The good news: pi-ai is built around exactly this. `getModel(provider, modelId)` is the only place the model is named, so swapping providers is a one-line change. If you put that line behind an env var (`MODEL_PROVIDER`, `MODEL_ID`), you can flip between Codex OAuth, OpenRouter, Anthropic API, and a local Ollama endpoint without touching agent code. Do this early — it costs nothing and saves you from a refactor later when you decide to graduate something to production.

The less-good news: different models have meaningfully different tool-calling behavior. Claude is generally the most reliable at structured tool use, GPT-4-class models are close behind, and things drop off from there. If you develop against one model and then swap to another for production, expect to spend time tuning prompts and tool descriptions. Not a blocker, just a thing to know — "works on Codex, ship to Claude" isn't always seamless.

**For "learn agents for work," some things worth deliberately exploring**

The naive agent loop (model → tool → model → answer) is the easy part. The hard parts that production systems wrestle with are where the real learning is:

*Context management.* What happens when the conversation gets long? Pi-agent-core gives you `transformContext` for exactly this — a hook to prune, summarize, or restructure messages before each LLM call. Building a homelab bot that has a 30-turn conversation will force you to confront this.

*Failure modes.* What happens when a tool throws? When the model calls a tool with bad arguments? When it hallucinates a tool that doesn't exist? When it gets stuck in a loop calling the same tool over and over? Handling these gracefully is most of the work in real agent systems.

*Observability.* When your agent does something weird, can you see why? Logging every turn — the messages going in, the tool calls coming out, the results — is the difference between "this works mysteriously" and "I understand this system." The `subscribe()` hook on the Agent is your friend; pipe it to a structured log file.

*Cost and latency awareness.* Production agent systems care about both. Tracking tokens-per-turn and time-per-turn from the start, even just logging them, builds intuition for what's expensive.

*Confirmation patterns for destructive actions.* Real agents don't just YOLO `rm -rf`. The pattern is: model proposes action, system pauses, user confirms, then it runs. Building this teaches you about agent state machines.

**On the OpenRouter angle for development specifically**

OpenRouter is genuinely nice for learning because you can A/B test the same prompt across 5 different models in 5 minutes. Their unified API means you change one string. If you're trying to build intuition for *how* different models behave as agents — which is genuinely useful for-work knowledge — that's hard to beat. Their paid tier (not free) lets you set data policies that exclude logging providers, so you're not stuck with the privacy trade-off if you start spending real money.

A pattern I'd suggest: OpenRouter for breadth (try lots of models cheaply, build calibration), Anthropic or OpenAI direct API for depth (when you've decided what to ship, go direct for reliability and slightly better pricing).

**One honest thing about Codex specifically**

If your work context involves agents using OpenAI's stack, Codex subscription gets you familiar with their models. If your work context is provider-agnostic or Anthropic-leaning, OpenRouter is the better learning tool because you'll see more variety. The "best for learning" answer depends a lot on which models you'll be deploying against in 6 months.

Want to keep building from here? Good directions, in roughly increasing order of effort:

- Add the env-var-based model swap so you can test across providers
- Add structured logging via `agent.subscribe()` so you can see every turn
- Build out the narrow-tool version (replacing `run_shell` with 5-6 specific tools) — this is where most real homelab-bot value lives
- Add persistence so conversations survive restarts
- Add a confirmation pattern for any tool that mutates state
- Build the runbooks/skills-lite system once you have enough tools that context matters

Which of these is most useful to you depends on whether you want to keep going on the learning track or get the bot to "actually useful" first.

## User

I’m actually interested in everything you brought up about production systems. I didn’t think about half that stuff

## Claude

Good — this is the meaty part, and it's what separates "I built a demo" from "I built something that works." Let me walk through each one with enough depth that you understand the *why*, not just the code.

**Context management**

The naive pattern is: every turn, send the entire conversation history to the model. This works until it doesn't. LLMs have context windows (200K tokens for Claude Sonnet, smaller for cheaper models), and pricing scales with input tokens — so a long conversation gets quadratically expensive because you're re-sending the whole history every turn.

Worse, models get *worse* with very long contexts. There's a well-documented "lost in the middle" effect where information buried in turn 15 of a 40-turn conversation is functionally invisible to the model even though it's technically in the window. So even if you could afford to send everything, you wouldn't want to.

The strategies in production systems, roughly in order of sophistication:

*Sliding window* — keep the last N turns, drop the rest. Trivial to implement, works fine for short-memory assistants where old context genuinely doesn't matter. Wrong for anything where the user might reference something from earlier.

*Summarization/compaction* — when the conversation hits some threshold (token count, turn count), summarize the older portion into a compact note ("Earlier: user asked about disk usage, we found /var was 90% full, user decided to clean up Docker images") and replace those turns with the summary. Pi-coding-agent does this automatically; for `pi-agent-core` you'd build it yourself in `transformContext`.

*Tool-result trimming* — tool outputs are often the biggest tokens in a conversation. A `journalctl` call might return 50KB. The model rarely needs the full output two turns later. A common pattern: keep the most recent tool result intact, replace older ones with a placeholder ("(tool output: 1247 lines, truncated)").

*Semantic retrieval* — for very long-running agents, store conversation chunks in a vector database and retrieve relevant ones based on the current query. This is where it gets architecturally serious.

For your homelab bot, the pragmatic approach is: sliding window of maybe 20 turns, plus tool-result trimming where any tool output older than 3 turns gets replaced with a one-line summary. Implement this in `transformContext` and you'll handle 95% of real cases.

**Failure modes**

There are a half-dozen distinct failure modes, and good agent systems handle each one specifically rather than wrapping everything in a generic try/catch.

*Tool throws an exception.* Default behavior in pi-agent-core: the error gets fed back to the model as the tool result. This is usually what you want — the model sees "tool failed: connection refused" and can adapt. Make sure your tools actually catch internal errors and return them as structured results rather than letting them crash the loop.

*Bad tool arguments.* Model calls `restart_service` with `{name: "the docker thing"}` instead of `{name: "docker"}`. Your tool's schema validation should catch this and return a clear error. The model usually self-corrects on the next turn if the error message is good. Bad error messages cause infinite loops.

*Hallucinated tool name.* Model invents `get_system_info` when you only have `disk_usage` and `service_status`. Pi-agent-core handles this — it'll return an error that the tool doesn't exist. Watch for this in logs; it usually means the model is confused about what's available, often because tool descriptions are unclear.

*Loops.* Model calls a tool, doesn't like the answer, calls it again with slightly different arguments, and again, and again. Without a circuit breaker, this can run until you hit token limits and burn money. The standard pattern: track tool call count per turn, abort if it exceeds some threshold (10-20 is reasonable). Pi-agent-core lets you do this in `beforeToolCall`.

*Model refuses to use tools.* Asks "can you run df -h?" and the model says "I'd be happy to help! You can run `df -h` in your terminal." This is a prompt engineering issue — the system prompt needs to be more directive about using tools, not suggesting them.

*Provider errors.* The LLM API itself fails: rate limit, timeout, 500. Pi-ai has retry logic but you should know it exists and configure it. For a Discord bot, a polite "I'm having trouble reaching the model, try again in a minute" is better than a stack trace.

**Observability**

This is the single biggest thing that separates "this works" from "I understand this." Build it in from the start; retrofitting is annoying.

The minimum viable version is structured JSON logging on every event from `agent.subscribe()`. For each turn, you want to capture: timestamp, user input, full message array sent to LLM (or at least token count), model used, tool calls made with arguments, tool results (or sizes), final response, total tokens (input/output split), latency, any errors. Write this to a file as JSONL, one line per event.

Why JSONL: you can grep it, pipe it to `jq`, load it into DuckDB or a Jupyter notebook, ship it to Loki/Grafana later. Plain text logs are useless for the kind of analysis you'll want to do.

What you do with this once you have it: when something weird happens, you can replay the exact context that produced the weirdness. When you want to know "how often does the model call the wrong tool," you can count. When you want to know "is my new prompt better," you can A/B test on real traffic and measure tool-call accuracy or response length. This is the difference between vibes-based development and engineering.

Production systems eventually want OpenTelemetry traces (every tool call as a span, the LLM call as a span, all under a parent "user message" span), pushed to something like Jaeger or Honeycomb. For a homelab bot, JSONL is plenty. For work, learning the OTel pattern is worth it — there's an open-source library called Langfuse and a commercial one called Helicone that both target this exact use case.

**Cost and latency awareness**

Every event from pi-agent-core that includes a model response also includes token usage. Log it. Then make a tiny dashboard, even just a SQL query, that gives you: tokens per user message (mean, p95), cost per user message, latency per turn, ratio of input to output tokens.

The numbers reveal things. "My average user message uses 8000 tokens" — why? Probably because tool outputs are huge. "P95 latency is 45 seconds" — why? Probably because the model is making 6 tool calls per turn instead of 2, which means your tool descriptions or system prompt are pushing it toward over-exploration.

Once you have the numbers, you can make trade-offs deliberately. "Switching to a smaller model would cut cost 5x but increase tool-call errors 3x — worth it?" That's an informed decision. Without numbers, it's gut feeling.

**Confirmation patterns**

The naive agent will happily run `docker rm -f production-db` if the model decides that's a good idea. The mature pattern is two-step: model proposes, human confirms, then execute.

Implementation has a few flavors:

*Tool-level confirmation.* Mark certain tools as "requires_confirmation." When the model calls them, instead of executing, return a result like "Pending confirmation from user: about to restart container 'plex'. Reply 'confirm' to proceed." The user sends "confirm" as the next message, and you have a state mechanism to know "this confirms the previous pending action." Pi-agent-core's `beforeToolCall` hook is where you intercept this.

*Two-tool pattern.* Split destructive operations into `propose_X` and `execute_X`. The model can call `propose_restart_service(name)` freely, which returns a confirmation token and a description. To actually execute, it needs to call `execute_restart_service(token)`, which only works if the user has approved the token. The user approval can come from a Discord button, a separate command, whatever.

*Read-only by default with explicit unlock.* The bot starts in read-only mode. To do anything destructive, the user has to send something like `!unlock 5min` which enables write tools for 5 minutes, then they auto-disable. Removes the per-action friction while keeping a safety boundary.

For a homelab bot, the read-only-by-default pattern is probably the cleanest. You're the only user, you can trust yourself with a time-bound unlock, and 99% of bot interactions are diagnostic and don't need it.

The deeper lesson here: **agent safety is mostly about constraining what the agent can do, not making the model "smarter" or "more careful."** The model will make mistakes; design the system so its mistakes are recoverable. This is true at every scale, from your homelab bot to actual production agent deployments.

---

This is a lot. Honest suggestion for how to actually use it: don't try to build all of this at once. Get the basic bot running. Add structured logging next, because everything else benefits from being able to see what's happening. Then pick the next problem based on what bites you first — probably context management, since long conversations break things visibly. Failure handling and confirmation patterns can wait until you've felt the pain of not having them.

Want to go deeper on any one of these? Observability is probably the highest-leverage if you're learning for work — the patterns transfer to literally any LLM application you'll build.

## User

Agreed, can you talk more about observability

## Claude

Good choice — this is the skill that compounds across every LLM project you'll touch. Let me go deep.

**Why this matters more for LLM systems than traditional software**

In a normal backend service, when something goes wrong, you have an exception, a stack trace, and deterministic inputs that you can replay. LLM systems break that model in three ways: the same input produces different outputs (non-determinism), there's no exception when the model is just *wrong* (it cheerfully returns a confident answer that's bullshit), and the "logic" lives in prose inside the prompt rather than in code you can read line-by-line.

This means traditional logging — "request received, processed, returned" — tells you almost nothing useful. You need to capture the LLM's decision-making process: what it saw, what it decided, why (to whatever extent "why" exists), and what the downstream effects were. Without that, debugging is pure guesswork.

The shift in mental model: you're not logging code execution, you're logging *cognitive traces*. Every LLM application is, at runtime, a series of decisions made by a stochastic system you don't fully control. Observability is how you make those decisions inspectable after the fact.

**The four pillars, in order of how I'd add them**

*Pillar 1: Structured event logs (do this first)*

Every interesting thing that happens gets a JSON line in a file. The schema I'd start with for each event:

```
{
  "timestamp": "2026-04-30T15:23:01.234Z",
  "trace_id": "uuid-per-user-message",
  "span_id": "uuid-per-event",
  "parent_span_id": "uuid-or-null",
  "event_type": "user_message" | "llm_call" | "tool_call" | "agent_response" | "error",
  "user_id": "discord-user-id",
  "data": { ...event-specific fields... },
  "metadata": { "model": "...", "duration_ms": 1234, ... }
}
```

The `trace_id` is the key insight — every event triggered by a single user message shares one trace ID. This lets you reconstruct the entire decision tree afterward by filtering on that ID. The `span_id`/`parent_span_id` lets you reconstruct the *hierarchy* (this tool call happened inside this LLM turn which happened inside this user message).

For each event type, capture:

- `user_message`: full text, channel/source, any metadata
- `llm_call`: full message array sent (or hash + reference if huge), model, parameters, full response, input tokens, output tokens, latency, finish reason
- `tool_call`: tool name, arguments, result (or truncated result + size), duration, success/failure, error if failed
- `agent_response`: final text returned to user, total tool calls in this turn, total LLM calls, total tokens, total cost, total latency
- `error`: where, what, stack trace, recovered or not

Concretely for pi-agent-core, you'd subscribe to the agent's events and translate them into this schema. The subscription gives you `text_delta`, `tool_call`, `tool_result`, etc. — wrap each in your event format and append to a JSONL file. About 50 lines of code.

Why JSONL specifically: every line is independently parseable, you can append without locks, you can grep with `jq`, you can `cat events.jsonl | jq 'select(.event_type=="tool_call")'` and immediately see every tool call. When you're ready, you can `duckdb` the file directly with SQL: `SELECT tool_name, COUNT(*) FROM read_json('events.jsonl') GROUP BY tool_name`. No infrastructure needed until you want it.

*Pillar 2: Metrics (add when you start caring about trends)*

Logs answer "what happened in this specific case." Metrics answer "what's the shape of behavior across many cases." You want both.

The metrics that actually matter for LLM systems:

- Token usage histograms: input tokens per turn (p50, p95, p99), output tokens per turn, total tokens per user message
- Cost per user message: derived from tokens × per-token price for the model
- Latency: time from user message to first response token (TTFT — time to first token), time to complete response
- Tool usage rates: which tools get called, how often, success rate per tool
- Tool call depth: how many tool calls per user message (if this is climbing, your prompt is probably making the model over-explore)
- Loop indicators: same tool called >3x in one turn — this is a smell
- Error rates: by error type, by model, by tool
- Cache hit rate: if you're using prompt caching (Anthropic and OpenAI both support this), what fraction of input tokens are cached

How you compute these: in the simple version, you periodically (every minute, every hour, on demand) run aggregation queries against your JSONL logs. In a more serious setup, you emit metrics live to Prometheus via a `/metrics` endpoint and graph them in Grafana. For a homelab bot, the periodic-aggregation approach is fine until it isn't.

The killer metric most people skip: **cost per resolved user request**. Not cost per LLM call, not cost per turn — cost per actual user-facing question answered. Track this and you'll have an immediate signal when something goes wrong (a buggy prompt that causes the model to loop will spike this 10x).

*Pillar 3: Distributed tracing (add when you have multiple services or want fancy debugging)*

OpenTelemetry is the standard. Each interesting operation becomes a "span" with start/end timestamps, attributes, and parent-child relationships. Spans get exported to a backend (Jaeger, Tempo, Honeycomb) where you can visualize them as flame graphs.

For an agent, the natural span structure is:

```
user_message_received (span)
├── llm_call_1 (span)
│   ├── tool_call: disk_usage (span)
│   └── tool_call: docker_ps (span)
├── llm_call_2 (span)
│   └── tool_call: service_status (span)
└── llm_call_3 (span) [final response]
```

Each span has attributes — for an llm_call span, you'd attach `model`, `input_tokens`, `output_tokens`, `temperature`, etc. For a tool_call span, `tool_name`, `arguments` (or a hash), `success`, etc.

The visualization is genuinely useful. You see immediately that "user message took 30 seconds" decomposes into "LLM call 1 was 4s, tool call 1 was 18s (!), LLM call 2 was 3s, etc." and now you know the tool is the bottleneck, not the model.

For your homelab bot, you don't need this until you're debugging something hairy. The JSONL events you logged in pillar 1 already have parent/child relationships via `parent_span_id`, so when you do want tracing later, you can either retrofit OTel or build a tiny visualizer that reads your JSONL and renders a tree.

*Pillar 4: Evals (add when you're iterating on prompts/tools)*

Logs and metrics tell you what *did* happen. Evals tell you whether changes you make will improve future behavior. They're tests for non-deterministic systems.

The basic structure: a dataset of (input, expected behavior) pairs, run through your agent, scored. The "expected behavior" rarely is exact text matching — it's more like:

- Did the agent call the right tool?
- Did the agent's response contain the key fact from the tool result?
- Did the agent avoid calling tools when none were needed?
- Did the agent refuse to do something it should refuse?
- Was the response under N tokens / above quality threshold?

Some of these you can check programmatically (tool was called or not). Some need an LLM-as-judge — a separate, more capable model that reads the agent's output and rates it. "Given this user message and this agent response, rate from 1-5 whether the response correctly addressed the question."

For a homelab bot, a small eval set is invaluable. Maybe 30 examples covering: simple queries, queries that need tool use, queries that need multiple tools, ambiguous queries, queries about things you don't have tools for, queries that should be refused. Run this set every time you change the prompt or add a tool, and you immediately catch regressions.

The libraries worth knowing about: Promptfoo, OpenAI Evals, Langfuse, Inspect (Anthropic's), Braintrust. For learning purposes, write your own first — it's about 100 lines and you'll understand the abstractions better.

**The development feedback loop this enables**

Once you have logs + metrics + evals, your dev loop becomes:

1. Notice something off in production (from metrics: "tool call depth crept up" or from a user complaint)
2. Find the specific failure cases in logs (filter by trace_id, see what happened)
3. Add those cases to your eval set
4. Try a fix (new prompt, new tool description, new tool, whatever)
5. Run evals — does it fix the bad cases without breaking the good ones?
6. Deploy, watch metrics for regression

This is the loop that makes LLM applications improvable rather than just buildable. Without it, every change is a gamble.

**Practical concretization for your bot**

Minimum viable observability for what you're building:

```ts
// Single file: logger.ts
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

interface EventLog {
  timestamp: string;
  trace_id: string;
  event_type: string;
  user_id?: string;
  data: any;
  metadata?: any;
}

class AgentLogger {
  constructor(private path: string) {}

  log(event: Omit<EventLog, "timestamp">) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...event,
    });
    appendFileSync(this.path, line + "\n");
  }

  newTrace(): string {
    return randomUUID();
  }
}

export const logger = new AgentLogger("./data/events.jsonl");
```

In your bot's message handler, before calling the agent:

```ts
const traceId = logger.newTrace();
logger.log({
  trace_id: traceId,
  event_type: "user_message",
  user_id: message.author.id,
  data: { content: userText, channel: message.channel.id },
});
```

In `agent.subscribe()`, log every event with the same `trace_id`. After the agent completes, log a `agent_response` event with totals (sum the tokens from all `llm_call` events, count tools, total latency).

That's it. Now you have a queryable record of every interaction. Run `cat data/events.jsonl | jq 'select(.event_type=="tool_call") | .data.tool_name' | sort | uniq -c` and you have your tool usage distribution. Add `duckdb` to query with SQL when grep stops being enough.

When you eventually want a UI, point Langfuse at this data — it's specifically designed for LLM observability and the data model is similar. Or build a tiny web view yourself; you have all the data.

**The thing I'd most want you to internalize**

Observability is not a thing you bolt on at the end. It's the substrate that makes every other improvement possible. The teams I've seen that build good agent systems are the ones who treat their logs as a first-class artifact — they read them daily, query them when something feels off, build dashboards for the metrics that matter to their use case, and curate eval sets from real failures.

The teams that don't do this build "demos that work most of the time" and never quite understand why some users have a bad experience.

For your work context: walking into a job and being the person who says "before we add features, can we get visibility into what the system is actually doing" is high-value. Most LLM-application teams are flying blind because the discipline isn't widespread yet. Being the one who fixes that is genuinely useful.

Want to go deeper on a specific piece? The two threads worth pulling on are: how to build a useful eval set for an agent (the methodology, not just the tooling), and how to set up actual OpenTelemetry tracing so the patterns transfer cleanly to production systems at work.

## User

Yeah so I know you’re wanting me to keep it simple for my homelab experiment, but all of the observability stuff sounds really cool and useful for work, so I’m probably going to quickly add it even if I don’t need it so I can better understand. And yes I’m interested in both threads you mentioned.

## Claude

Good instinct, and honestly the right call. Building observability before you "need" it teaches you what good observability *looks like* — by the time you need it for something high-stakes, you've already developed taste. Plus your homelab bot is the perfect low-stakes sandbox to make all the mistakes in.

Let me take both threads in depth.

---

## Thread 1: Building useful eval sets for agents

The shift in mindset that has to happen first: evals for agents are not unit tests. Unit tests assert exact equality. Evals measure behavior across a distribution of inputs against rubrics that tolerate variation. If you try to write evals as "given input X, assert output equals Y," you'll fail and conclude evals don't work. The right framing is closer to grading student essays — you have rubrics, you have judgment calls, and you're measuring whether the system does the *kind of thing* you want, not the exact thing.

**Where eval datasets actually come from**

The single biggest mistake people make: they make up eval cases at a whiteboard and then run them. These evals end up testing what the developer thought of, not what users actually do. The cases miss real failure modes and over-represent contrived ones.

The right sources, in order of value:

*Real production logs.* Your JSONL events are the goldmine. Once you have a week of real interactions, the eval set should mostly come from there. Pick examples that span: things that worked great, things that broke, things that were weird, things at the edges of your tool capabilities. The cases your *users actually generate* are the cases your evals should cover.

*Failure cases, religiously curated.* Every time something goes wrong in production — model called the wrong tool, hallucinated a result, got stuck in a loop, refused something it should've done — that case goes into the eval set. This is how you guarantee regressions get caught. After a few months, your eval set is a museum of every failure mode you've ever seen, and any change that resurrects an old failure gets flagged before deploy.

*Adversarial cases you generate.* Once you have a baseline, deliberately try to break it. "What if the user asks for something my tools can't do?" "What if the user's question is ambiguous?" "What if the question is about something destructive?" "What if it's in a different language?" "What if there are typos?" These cases probe the edges; they don't represent typical use but they catch the brittleness.

*Synthetic generation, carefully.* You can use a strong LLM to generate eval cases (give it your tool descriptions and ask "generate 50 questions a user might ask"). This is fast and useful for bootstrapping but biased — the LLM generates cases that are easy for itself to handle. Don't let synthetic dominate your set.

For your homelab bot, the bootstrap path: hand-write 10 cases covering your main use cases, then operate the bot for a week, then curate 20-30 real cases from logs. That's your starting eval set. Grow it whenever something interesting happens.

**The structure of an eval case**

Each case isn't just "input → expected output." It's richer:

```yaml
id: disk-usage-basic
input: "How full is the main drive?"
context:
  prior_messages: []  # for multi-turn cases, what came before
expected_behavior:
  - type: tool_called
    tool: run_shell  # or disk_usage if you have it
    must_call: true
  - type: tool_arguments
    contains: "df"
  - type: response_content
    rubric: "Response should state the disk usage percentage or available space"
  - type: response_constraints
    max_tokens: 500
    no_apology: true  # don't say "I'm sorry but..." for things you can do
metadata:
  category: diagnostic
  difficulty: easy
  source: hand-written
```

The expected_behavior list is the key insight. Different cases need different checks. Some checks are programmatic (was a tool called? did its arguments match a regex?). Some are semantic (does the response address the question?). You compose the rubric per case.

**The check types and how to implement each**

*Programmatic checks (deterministic):*

- "Tool X was called" — inspect the trace, look for tool_call events
- "Tool X was called with arguments matching pattern Y" — regex or JSON-schema match
- "No tool was called" — for queries that shouldn't trigger tools
- "Tool calls completed within N steps" — count tool_call events
- "Response is under N tokens" — count
- "Response contains literal string Z" — substring match (rare; usually too brittle)
- "Response does NOT contain pattern Z" — useful for avoiding apologies, refusals, hedging

These are cheap, fast, and reliable. Start here.

*LLM-as-judge checks (semantic):*

For things you can't check programmatically — "did the response correctly summarize the disk situation," "was the tone appropriate," "did it suggest a reasonable next step" — you call out to a separate LLM with a structured rubric:

```
You are evaluating an agent's response.

User question: {input}
Agent response: {output}
Tool calls made: {tool_calls}

Rate the following on a scale of 1-5:
- Correctness: Does the response accurately reflect the tool results?
- Helpfulness: Does it address what the user actually wanted?
- Conciseness: Is it appropriately brief without being terse?

Respond as JSON: {"correctness": N, "helpfulness": N, "conciseness": N, "reasoning": "..."}
```

Important practices for LLM-as-judge:
- Use a *different and stronger* model than the one being evaluated (Claude Opus judging Sonnet, GPT-4 judging GPT-4o-mini). Same-model evaluation has known biases — models prefer their own outputs.
- Always require reasoning before the score, not after. "Reasoning then score" produces calibrated scores; "score then reasoning" produces post-hoc rationalization.
- Use small integer scales (1-5) not continuous (0-100). Models are bad at the latter.
- Run the judge multiple times on the same case and average — judges are also stochastic.
- Periodically spot-check the judge against your own ratings to make sure it's calibrated to what you actually care about.

*Trajectory checks (agent-specific):*

For agents specifically, you care about *how* it got to the answer, not just the answer. A response that's right for the wrong reasons is fragile. Trajectory checks examine the sequence of tool calls:

- Did it call tools in a sensible order?
- Did it avoid redundant calls (calling `disk_usage` twice for no reason)?
- Did it explore appropriately or thrash?
- Did it call destructive tools without confirmation when it shouldn't have?

These need either programmatic rules per case or LLM-as-judge with the full trajectory in context.

**The eval runner architecture**

A minimal runner:

```ts
async function runEval(eval: EvalCase, agent: Agent): Promise<EvalResult> {
  // Reset agent to clean state with prior_messages if any
  const trace: TraceEvent[] = [];
  const unsubscribe = agent.subscribe((event) => trace.push(event));

  const startTime = Date.now();
  let response: string;
  let error: Error | null = null;

  try {
    response = await agent.prompt(eval.input);
  } catch (e) {
    error = e as Error;
    response = "";
  }

  const duration = Date.now() - startTime;
  unsubscribe();

  // Run each check
  const results = await Promise.all(
    eval.expected_behavior.map(check => runCheck(check, { response, trace, eval }))
  );

  return {
    eval_id: eval.id,
    passed: results.every(r => r.passed),
    checks: results,
    response,
    trace,
    duration_ms: duration,
    error,
  };
}
```

Then aggregate across cases and produce a report: pass rate overall, pass rate by category, comparison against previous runs. The "compare against previous runs" piece is what makes it useful for development — you check in evals to git, run them in CI on every change, and see which cases broke.

**Eval-driven development for prompts**

The actual workflow once you have evals:

1. Set a baseline. Run evals against your current system, record the pass rate.
2. Make a change (new prompt wording, new tool description, new model).
3. Re-run evals. See which cases changed status (newly passing, newly failing).
4. Inspect the failures specifically. Was your change actually wrong, or did the evals reveal something?
5. Iterate.

The non-obvious thing: this discipline forces you to articulate what you actually want. When you write a check for "the response should not apologize for not having the answer when it actually has it," you're now thinking about a specific behavior you want, and you can reason about it. Without evals, "be helpful" stays vague.

**A subtle but important practice**

Tag every eval case with where it came from and why. "Real failure 2026-04-15 — model hallucinated docker container name" is far more useful in 6 months than just "test_27." When evals fail, you want to immediately remember why the case exists at all.

---

## Thread 2: OpenTelemetry tracing in practice

OTel has a reputation for being overcomplicated and it's partially deserved — the spec is sprawling, the SDKs have evolved, and there are 17 ways to do anything. But the *core* concepts are simple, and once you've internalized them, you can drop into any modern observability stack and be productive. For your work-relevance goal, this transfers cleanly.

**The conceptual model**

A *trace* is a single end-to-end operation (one user message handled by your agent). A trace contains many *spans*, each representing a unit of work within that trace. Spans have parent-child relationships, forming a tree. Each span has: a name, start/end timestamps, status (ok/error), attributes (key-value metadata), and events (timestamped log entries within the span).

That's it. Everything else is mechanism.

The mental model: imagine you're doing a code review of a function call. You want to see what happened, in what order, how long each part took, and what data flowed through. Spans are how you serialize that view of execution into something you can inspect later.

**Mapping agent operations to spans**

For your agent, the natural span hierarchy:

```
agent.handle_user_message [trace root]
├── agent.context_management
├── llm.completion (turn 1)
│   └── attributes: model, input_tokens, output_tokens, finish_reason
├── tool.disk_usage
│   └── attributes: arguments, result_size, exit_code
├── llm.completion (turn 2)
├── tool.docker_ps
├── llm.completion (turn 3) [final]
└── agent.send_response
```

Each LLM call is a span. Each tool call is a span. The whole user-message handling is the root span. Attribute the spans with the data you care about — token counts on LLM spans, tool arguments on tool spans, etc.

Conventions matter here. There's an emerging standard called "OpenTelemetry Semantic Conventions for GenAI" that defines specific attribute names like `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, etc. Use these where they fit — backends like Langfuse, Honeycomb, and Datadog have built-in dashboards that key off these attribute names. Don't invent your own naming if a standard one exists.

**Setting it up in Node**

The Node OTel SDK has had churn but the current pattern is stable:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

Then a `tracing.ts` that you import *first* (before anything else, even your other imports — instrumentation works by patching modules at require time):

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "homelab-agent",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
});

sdk.start();

process.on("SIGTERM", () => sdk.shutdown());
```

In your bot's main file:

```ts
import "./tracing";  // MUST be first
import { Client } from "discord.js";
// ... rest of imports
```

The `OTLPTraceExporter` ships traces to any OTel-compatible backend over HTTP. Local dev: run Jaeger in Docker (`jaegertracing/all-in-one`), it accepts OTLP on port 4318 and gives you a UI on 16686. For production: same exporter, different URL — Honeycomb, Datadog, Grafana Tempo, all speak OTLP.

**Creating spans manually for agent operations**

The auto-instrumentations cover HTTP, but your agent's logical structure (tool calls, LLM calls) is invisible to them. You create those spans manually:

```ts
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("homelab-agent");

async function handleUserMessage(message: Message) {
  return tracer.startActiveSpan("agent.handle_user_message", async (span) => {
    span.setAttributes({
      "user.id": message.author.id,
      "discord.channel_id": message.channel.id,
      "discord.message_length": message.content.length,
    });

    try {
      const response = await processWithAgent(message);
      span.setStatus({ code: SpanStatusCode.OK });
      return response;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

`startActiveSpan` is the magic — it makes the span the "active" one in async context, so any spans created inside (in tools, LLM calls, etc.) automatically become children. No need to pass span objects around.

For tool wrapping:

```ts
function wrapToolWithTracing(tool: AgentTool): AgentTool {
  return {
    ...tool,
    execute: async (args) => {
      return tracer.startActiveSpan(`tool.${tool.name}`, async (span) => {
        span.setAttributes({
          "tool.name": tool.name,
          "tool.arguments": JSON.stringify(args),
        });
        try {
          const result = await tool.execute(args);
          span.setAttributes({
            "tool.result_size": JSON.stringify(result).length,
          });
          return result;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      });
    },
  };
}
```

Apply this to every tool before passing to the agent. Now every tool call gets a span automatically.

For LLM call wrapping, it depends on whether pi-ai exposes a hook. If not, you can wrap `streamSimple`/`completeSimple` once at import time and create an `llm.completion` span around each call, attaching `gen_ai.*` attributes from the response.

**Connecting traces to your structured logs**

Don't throw away your JSONL logs when you add OTel — they complement each other. The pattern: pull the active trace ID into every log line.

```ts
import { trace } from "@opentelemetry/api";

function getCurrentTraceContext() {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

logger.log({
  ...getCurrentTraceContext(),
  event_type: "tool_call",
  // ...
});
```

Now when you see a slow trace in Jaeger, you can grep your JSONL for that trace_id and get the full event log with arguments and results. When you see a weird event in your logs, you can pull up the trace in Jaeger to see the timing context. Best of both.

**The local dev setup that actually feels good**

Run Jaeger:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Run your bot. Open `http://localhost:16686`. Service: `homelab-agent`. Click search. Click any trace. You see the full waterfall of every span — LLM calls, tool calls, with timings and attributes.

This is the moment when observability clicks. You can *see* your agent thinking. "Oh, that response took 8 seconds because the model made 4 LLM calls and one of them took 5 seconds." "Oh, this tool call had `connection_refused` in its attributes — that explains the weird response."

**LLM-specific observability backends**

The general-purpose OTel backends (Jaeger, Tempo, Honeycomb) work fine but treat your traces as generic. There's a category of LLM-specific platforms that understand `gen_ai.*` attributes and give you tailored views:

- **Langfuse** (open source, self-hostable) — built specifically for LLM apps, gives you traces, evals, prompt management, and cost tracking in one tool. Works with OTel input. For learning, this is probably the highest-value single tool to set up.
- **Helicone** (commercial, free tier) — proxy-based, easiest setup, focused on cost/latency dashboards.
- **Phoenix** (open source from Arize) — strong on evals and trace analysis, also OTel-native.

For your homelab bot, the move I'd suggest: start with Jaeger to learn raw OTel, then add Langfuse on top once you have traces flowing. Langfuse will pick up your existing OTel exports if you point them at it. You get familiar with the standard tooling and the LLM-specific tooling at once.

**Patterns worth knowing for production work**

*Sampling.* In production with high volume, you don't trace every request — you sample. Common pattern: trace 100% of errors and slow requests, sample 1% of normal traffic. OTel has built-in samplers; configure based on your volume.

*Trace context propagation.* When your agent calls an HTTP service that's also instrumented, you want the trace to span both. OTel does this automatically via HTTP headers (`traceparent`) if both ends use the SDK. Useful as your system grows beyond one process.

*Sensitive data in attributes.* Attributes get shipped to your backend. Don't put API keys, passwords, or full LLM prompts (which might contain user PII) in attributes. Either redact, or only attach hashes/sizes. Most platforms have configurable scrubbing rules; use them.

*Cardinality.* Avoid putting unbounded high-cardinality values in attributes (like full user message text). Backends index attributes for search, and high-cardinality kills performance. Hash or bucket.

*Span events vs child spans.* For brief notable moments inside a span ("retry attempt 2", "cache miss"), use `span.addEvent("retry", { attempt: 2 })` rather than creating a child span. Events are cheaper and more appropriate for point-in-time markers.

**The skill that transfers**

The thing that makes OTel valuable for your work isn't the specific Node SDK calls — those will change. It's the *thinking* in spans and traces. Once you naturally decompose any system into "what's the unit of work, what are its sub-units, what attributes describe it," you can instrument any codebase. You can also read other people's traces and quickly understand unfamiliar systems. This is a senior-engineer skill that's increasingly expected in any backend role and especially in LLM-application work.

---

This was a lot. The order I'd actually do it for your bot:

1. Get the JSONL structured logging working first. It's the foundation.
2. Add OTel with Jaeger locally. You've now got two views of the same data.
3. Build a tiny eval set (10 cases) by hand. Run it, see how the runner feels.
4. Operate the bot for a week, accumulate real interactions in your logs.
5. Curate eval cases from real interactions. Now your eval set has teeth.
6. When you make any change, run evals first. Watch the metrics in Grafana/Langfuse.
7. Once it's all working, swap in Langfuse for the LLM-specific dashboards.

By the time you've done this, you'll have hands-on experience with the entire observability stack that production LLM teams use. That's the work-relevant outcome.

Want to keep pulling? Adjacent threads worth exploring: prompt management (treating prompts as versioned artifacts, A/B testing them), guardrails (input/output validation as a separate layer), or agent-specific evaluation frameworks like Inspect (which is what Anthropic uses internally and is quite elegant).

## User

im on the 03-repl.ts example, could you come up with a plan for walking me through building up what weve talked about so far?

## Claude

Absolutely. Here's a staged plan that builds from where you are (`03-repl.ts` with one shell tool) up through the full observability and evaluation stack. Each stage is self-contained, takes maybe an evening, and produces something that works on its own — so if you stop at any point, you have a working artifact.

---

## The plan

**Stage 0: Where you are**

REPL with `run_shell`, in-memory conversation, no observability, no Discord. Good baseline.

**Stage 1: Refactor for sanity (foundation)**

Before adding anything new, restructure into multiple files. Right now everything is in one script; adding observability and Discord on top of that becomes painful. We'll split into:

- `src/agent.ts` — agent factory, tool definitions
- `src/config.ts` — env-var-driven model selection (so you can swap providers later)
- `src/repl.ts` — REPL loop using the factory
- `src/index.ts` — entry point

This stage doesn't add features, it just makes everything else easier. It also introduces the env-var model swap we talked about — `MODEL_PROVIDER=anthropic MODEL_ID=claude-sonnet-4-5-20250929` controls what gets used. Spend an evening on this.

**Stage 2: Narrow tools**

Replace `run_shell` with 4-5 specific tools: `disk_usage`, `memory_info`, `uptime`, `service_status(name)`, `docker_ps`. Each one runs a fixed command with validated arguments. Two reasons we do this now: the model behaves better with narrow tools, and observability becomes more meaningful when you can see "tool: docker_ps" instead of "tool: run_shell with args: ..." for every call.

You'll feel the model's behavior change. It'll start picking the right tool for the question instead of always reaching for the shell. This is your first lesson in tool design.

**Stage 3: Structured JSONL logging (observability pillar 1)**

Add the `logger.ts` from earlier — JSONL events with trace IDs. Subscribe to the agent's events, translate each into a structured log entry, append to `data/events.jsonl`. Log user messages, LLM calls (with token counts), tool calls (name, args, result size, duration), final responses (with totals), and errors.

By the end of this stage, you can `cat data/events.jsonl | jq` and see every interaction in detail. Run a few queries:

```bash
# Tool usage distribution
cat data/events.jsonl | jq -r 'select(.event_type=="tool_call") | .data.tool_name' | sort | uniq -c

# Average tokens per user message
cat data/events.jsonl | jq 'select(.event_type=="agent_response") | .data.total_tokens' | awk '{sum+=$1; n++} END {print sum/n}'
```

This is where the "I can see what's happening" feeling kicks in. Worth lingering here — play with `jq`, try DuckDB on the file (`duckdb -c "SELECT event_type, COUNT(*) FROM read_json_auto('data/events.jsonl') GROUP BY 1"`).

**Stage 4: Persistence**

Save `agent.state.messages` to `data/conversations/<userId>.json` after each turn. Load on agent creation. Now conversations survive process restarts. Small stage, satisfying win.

**Stage 5: Discord wrapper**

Wrap everything from stages 1-4 in the Discord bot from earlier in our conversation. The agent factory, tools, logging, and persistence all just work — Discord is a thin shell on top. Per-user agents stored in a Map, each with its own conversation history. The Discord bot becomes the second "frontend" for the same agent core, validating that the abstractions are clean.

This is also when you containerize: `Dockerfile`, `docker-compose.yml`, deploy to your homelab. Real "always-on" assistant from this point.

**Stage 6: Failure handling**

Add the failure-mode protections we discussed:
- Loop detection in `beforeToolCall` — abort if same tool called >5 times per turn
- Retry-with-backoff for LLM provider errors
- Better error messages from tools (so the model can self-correct)
- Total tool-call cap per user message (maybe 20)

You'll want this before you've felt the pain of not having it. Trust me here — it's worth the prevention.

**Stage 7: Context management**

Add the `transformContext` hook with two behaviors:
1. Sliding window: keep last 20 turns
2. Tool-result trimming: replace tool results older than 3 turns with `"(truncated: <N> bytes)"`

Test it by having a long conversation and watching token counts in your logs stay bounded instead of exploding.

**Stage 8: OpenTelemetry tracing (observability pillar 3)**

Skipping pillar 2 (metrics dashboards) because your JSONL + jq covers that adequately at this scale. Pillar 3 is more interesting and transfers more directly to work skills.

Set up OTel SDK, run Jaeger locally in Docker, wrap each tool and the agent's main loop in spans. Use the `gen_ai.*` semantic conventions for LLM call attributes. Connect trace IDs back to your JSONL logger.

Open Jaeger UI, click a trace, see your agent's full execution as a flame graph. This is the moment that pays off all the prior work.

**Stage 9: Evaluation framework**

Build the eval runner from earlier. Hand-write 10-15 cases covering your tools and edge cases. Implement check types: `tool_called`, `tool_not_called`, `response_contains`, `response_max_tokens`, and an LLM-as-judge check using Claude Opus or GPT-4 as the judge.

Wire it into a script: `npm run evals` runs the suite, prints a report, exits non-zero on regression. Now changes can be evaluated objectively.

**Stage 10: Confirmation pattern for destructive actions**

Add a `restart_service` or `restart_container` tool, but gate it behind the read-only-by-default-with-unlock pattern. Bot starts read-only. Send `!unlock 5min` (or use a Discord button) and destructive tools become callable for 5 minutes, then auto-disable.

This is the capstone — the bot can now actually *do* things, but with safety rails. By this point you've touched every concept we discussed.

**Stage 11 (optional): Langfuse**

Once everything's running, point your OTel exporter at Langfuse instead of (or in addition to) Jaeger. Now you get LLM-specific dashboards: cost over time, tokens per conversation, prompt versions if you start using them. This is the closest you'll get to "production observability" on a homelab project.

---

## How I'd suggest using this

Don't rush. Each stage should feel like its own little project. Code, then play with it for a day, then move on. The play part is where intuition gets built — running queries against your JSONL, watching traces in Jaeger, deliberately breaking things to see how failures show up.

When you start a stage, tell me which one and I'll walk you through it with full code. I won't preempt — I want each stage to start with the question "what's actually here, what's about to change, why" rather than dumping everything at once.

A few meta-points worth saying upfront:

The stages are ordered so each builds on the last *and* so the earliest ones unlock observability into the later ones. By the time you're doing context management in stage 7, you have logging that lets you actually verify it's working. That's deliberate.

Some stages will reveal that something from an earlier stage was wrong. That's good — that's how you learn what good design looks like. We'll refactor as needed.

You'll probably want to deviate. Maybe you'll get to stage 4 and want to add a new tool before persistence, or you'll skip Discord because you prefer a TUI. That's fine. The plan is a scaffold, not a contract.

When you're ready, just say "stage 1" and we'll go.

## User

stage 1

## Claude

Good. Stage 1 is pure refactoring — no new features, just better structure. The goal is that by the end, you can swap models with an env var, your agent definition lives in one place, and adding the Discord bot in stage 5 is a 30-line file instead of a 200-line file.

**What we're starting from**

Your `03-repl.ts` has everything in one file: tool definition, agent construction, subscribe handler, and REPL loop. That's fine for one file, but we're about to add observability, persistence, and a second frontend (Discord). All of that wants to share the agent setup. So we extract.

**The target structure**

```
homelab-agent/
├── src/
│   ├── config.ts        # env-var-driven model selection
│   ├── tools.ts         # tool definitions (just run_shell for now)
│   ├── agent.ts         # agent factory function
│   └── repl.ts          # REPL frontend
├── package.json
├── tsconfig.json
└── .env
```

`repl.ts` will be the entry point for now. Later, `discord.ts` joins it as a sibling — both will import from `agent.ts`.

**`src/config.ts`**

```ts
import { getModel } from "@mariozechner/pi-ai";

export interface AppConfig {
  model: ReturnType<typeof getModel>;
  systemPrompt: string;
}

export function loadConfig(): AppConfig {
  const provider = process.env.MODEL_PROVIDER ?? "anthropic";
  const modelId = process.env.MODEL_ID ?? "claude-sonnet-4-5-20250929";

  return {
    model: getModel(provider, modelId),
    systemPrompt:
      "You are a homelab assistant. Use the available tools to answer " +
      "questions about the system. Use run_shell only for read-only " +
      "diagnostics (df, free, uptime, docker ps, systemctl status, journalctl). " +
      "Never run anything that modifies state without confirming with the user first. " +
      "Keep responses concise.",
  };
}
```

The `provider` and `modelId` come from environment, with sensible defaults. To swap to OpenAI later: `MODEL_PROVIDER=openai MODEL_ID=gpt-4o-mini npx tsx src/repl.ts`. Same code, different model. We'll lean on this in stage 9 when we run evals against multiple models.

**`src/tools.ts`**

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export const runShellTool: AgentTool = {
  name: "run_shell",
  label: "Run shell command",
  description:
    "Runs a read-only shell command. Refuse anything destructive. " +
    "Good for: df, free, uptime, docker ps, systemctl status, journalctl.",
  parameters: Type.Object({
    command: Type.String({ description: "Command to run" }),
  }),
  execute: async ({ command }) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      });
      return { stdout, stderr };
    } catch (err: any) {
      return {
        error: err.message,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      };
    }
  },
};

export const allTools: AgentTool[] = [runShellTool];
```

Two small improvements while we're here: a `maxBuffer` so a misbehaving command doesn't consume unbounded memory, and the catch returns a structured error result instead of throwing — which means the model sees the failure as a tool result and can adapt, rather than the whole loop crashing. This is the "good failure mode" stuff we talked about, applied early.

**`src/agent.ts`**

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { loadConfig } from "./config.js";
import { allTools } from "./tools.js";

export function createAgent(): Agent {
  const config = loadConfig();

  return new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: allTools,
      thinkingLevel: "off",
      messages: [],
    },
    streamFn: streamSimple,
  });
}
```

A factory function. One job: produce a configured `Agent`. Both the REPL and the future Discord bot will call this. When stages 3 and 4 add logging and persistence, this is where they get wired in — every frontend benefits automatically.

**`src/repl.ts`**

```ts
import "dotenv/config";
import * as readline from "node:readline/promises";
import { createAgent } from "./agent.js";

async function main() {
  const agent = createAgent();

  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("homelab-agent REPL. Ctrl-C to quit.\n");

  while (true) {
    const input = await rl.question("\nyou> ");
    if (!input.trim()) continue;
    process.stdout.write("\nagent> ");
    try {
      await agent.prompt(input);
    } catch (err: any) {
      console.error(`\n[error] ${err.message}`);
    }
    process.stdout.write("\n");
  }
}

main();
```

The REPL is now thin. It imports `createAgent`, wires up streaming output, and runs the loop. If you want to add a Discord frontend later, it'll be a sibling file with the same shape — import `createAgent`, wire output to Discord messages instead of stdout. Same agent, different surface.

**`.env`**

```
ANTHROPIC_API_KEY=sk-ant-...

# Optional — defaults shown:
# MODEL_PROVIDER=anthropic
# MODEL_ID=claude-sonnet-4-5-20250929
```

**`package.json` updates**

You'll need `dotenv` if you don't have it, and `"type": "module"` if it's not already there:

```bash
npm install dotenv
```

Add a script for convenience:

```json
{
  "type": "module",
  "scripts": {
    "repl": "tsx src/repl.ts"
  }
}
```

**`tsconfig.json`**

If you don't have one, this is a reasonable starting point:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

**Run it**

```bash
npm run repl
```

Behaves identically to your old `03-repl.ts`. That's the point — refactoring should be a no-op functionally. Test a few prompts to confirm.

---

**Things to notice while you're in here**

The `.js` extensions in imports look weird in TypeScript. They're correct — when TypeScript compiles to ESM (or `tsx` runs ESM), the runtime resolution expects `.js`. This is a Node ESM quirk; you get used to it.

The agent factory pattern is doing real work even though it looks trivial. You could have called `new Agent(...)` directly in `repl.ts` and Discord. But then changes to setup (and there will be many — logging in stage 3, persistence in stage 4, context management in stage 7) require touching every frontend. The factory is the seam where those changes go.

The system prompt now lives in `config.ts`. When you start iterating on it (and you will — prompts are most of the work), you'll want it isolated. In stage 9 when we add evals, the system prompt becomes a versioned artifact — you'll want to test changes to it without touching agent code.

`loadConfig()` runs on every `createAgent()` call. That's fine for now. If you ever need different agents with different configs in one process — say, a "diagnostic" agent and a "maintenance" agent for stage 10 — you'd parameterize the factory: `createAgent(configOverrides)`.

---

**A small homework, if you're up for it**

Before saying "stage 2," try one or both of these — they'll deepen your sense of what's here:

Add a second model option. In your `.env`, set `MODEL_PROVIDER=openai MODEL_ID=gpt-4o-mini` (you'll need an `OPENAI_API_KEY` in `.env` too). Run the REPL, ask the same question you'd ask Claude. Notice the differences in how it uses the tool. This is your first "model has a personality" experience.

Add a sanity check at the top of `loadConfig()`: throw a clear error if the relevant API key isn't set. Right now, missing keys produce a confusing error deep in pi-ai. A 3-line check like `if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set")` saves future-you 10 minutes of confusion.

Whenever you're ready, say "stage 2" and we'll move to narrow tools.

## User

lets move on to stage 2 and can you switch to bun instead of npm directly

## Claude

Good call on Bun — it handles TypeScript natively without `tsx`, has `dotenv` built in, and starts faster. The migration is mostly cosmetic but worth doing now before the project gets bigger.

## Bun migration first

**Install bun if you haven't:**

```bash
curl -fsSL https://bun.sh/install | bash
```

**Migrate the project:**

```bash
rm -rf node_modules package-lock.json
bun install
```

That's mostly it. Bun reads your existing `package.json` and creates a `bun.lock` instead.

**Update `package.json`:**

Drop the `tsx` and `dotenv` dev dependencies — Bun handles both. Update the script:

```json
{
  "type": "module",
  "scripts": {
    "repl": "bun run src/repl.ts"
  }
}
```

Then remove unused deps:

```bash
bun remove tsx dotenv
```

**Update `src/repl.ts`:**

Remove the `import "dotenv/config";` line at the top. Bun loads `.env` automatically.

**Run it:**

```bash
bun run repl
```

Same behavior, faster startup, fewer dependencies. From here on I'll write everything assuming Bun.

One nice Bun-specific thing worth knowing: `Bun.file()` and `Bun.write()` are fast async file APIs that we'll use in stages 3 and 4 for logging and persistence. They're easier than the `node:fs/promises` equivalents.

---

## Stage 2: Narrow tools

**Why this matters before observability**

Your current `run_shell` is a single tool that does everything. Every model decision looks the same in logs: `tool: run_shell, args: {command: "..."}`. When we add observability in stage 3, that's not very informative — you can't easily see *which kind* of operation the model is doing, just that it ran a shell command.

Narrow tools also change the model's behavior. With `run_shell` plus a vague system prompt, the model basically free-styles bash. With named tools that have clear descriptions, the model picks tools deliberately. This is more reliable, more debuggable, and — counterintuitively — usually produces *better* results because the tool descriptions act as a structured prompt that primes the model toward correct usage.

You'll also feel a real failure mode here: smaller models that can't reliably handle `run_shell` will handle narrow tools much better. This generalizes to your work context — when production teams move from prototype to production, narrow tools is one of the most common refactors.

**The plan**

We're replacing `run_shell` with five narrow tools:

- `disk_usage(path?)` — wraps `df -h`
- `memory_info()` — wraps `free -h`
- `system_uptime()` — wraps `uptime`
- `service_status(name)` — wraps `systemctl status <name>`
- `docker_ps()` — wraps `docker ps`

Each one runs a fixed command, validates arguments, and returns structured output where possible. We're also keeping `run_shell` around as an "escape hatch" tool that's only registered when an env var is set — useful for debugging, but off by default.

**`src/tools.ts` rewrite**

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Shared helper — every tool eventually wraps a command, this centralizes
// timeout, buffer limits, and error shape so tools stay consistent.
async function runCommand(
  command: string,
  options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: options.timeoutMs ?? 10_000,
      maxBuffer: 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      exitCode: err.code ?? 1,
    };
  }
}

// --- Narrow tools ---

export const diskUsageTool: AgentTool = {
  name: "disk_usage",
  label: "Check disk usage",
  description:
    "Returns disk usage for mounted filesystems via `df -h`. " +
    "Use this whenever the user asks about disk space, free space, or storage capacity.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Optional path to check. Defaults to all mounted filesystems.",
      }),
    ),
  }),
  execute: async ({ path }) => {
    const cmd = path ? `df -h ${JSON.stringify(path)}` : "df -h";
    return runCommand(cmd);
  },
};

export const memoryInfoTool: AgentTool = {
  name: "memory_info",
  label: "Check memory usage",
  description:
    "Returns RAM and swap usage via `free -h`. " +
    "Use this whenever the user asks about memory, RAM, or swap.",
  parameters: Type.Object({}),
  execute: async () => runCommand("free -h"),
};

export const systemUptimeTool: AgentTool = {
  name: "system_uptime",
  label: "Get system uptime",
  description:
    "Returns system uptime and load averages via `uptime`. " +
    "Use this when the user asks how long the system has been running or about CPU load.",
  parameters: Type.Object({}),
  execute: async () => runCommand("uptime"),
};

export const serviceStatusTool: AgentTool = {
  name: "service_status",
  label: "Check systemd service status",
  description:
    "Returns the status of a systemd service via `systemctl status`. " +
    "Use this to check if a specific service is running, stopped, or failed.",
  parameters: Type.Object({
    name: Type.String({
      description: "Service name (e.g., 'docker', 'nginx', 'sshd')",
      pattern: "^[a-zA-Z0-9._@-]+$", // basic sanity
    }),
  }),
  execute: async ({ name }) => {
    // Validate again at runtime — schema validation is the model's responsibility
    // to follow, but we don't trust it.
    if (!/^[a-zA-Z0-9._@-]+$/.test(name)) {
      return {
        stdout: "",
        stderr: `Invalid service name: ${name}`,
        exitCode: 1,
      };
    }
    return runCommand(`systemctl status ${name} --no-pager`);
  },
};

export const dockerPsTool: AgentTool = {
  name: "docker_ps",
  label: "List running Docker containers",
  description:
    "Lists running Docker containers via `docker ps`. " +
    "Returns container ID, image, status, ports, and name for each.",
  parameters: Type.Object({
    all: Type.Optional(
      Type.Boolean({
        description: "If true, show stopped containers too. Defaults to running only.",
      }),
    ),
  }),
  execute: async ({ all }) => {
    const cmd = all ? "docker ps -a" : "docker ps";
    return runCommand(cmd);
  },
};

// --- Escape hatch (off by default) ---

export const runShellTool: AgentTool = {
  name: "run_shell",
  label: "Run shell command (debug only)",
  description:
    "Run an arbitrary read-only shell command. Only use when no narrower tool fits. " +
    "Refuse anything destructive.",
  parameters: Type.Object({
    command: Type.String({ description: "Command to run" }),
  }),
  execute: async ({ command }) => runCommand(command, { timeoutMs: 15_000 }),
};

// --- Tool registry ---

export function getTools(): AgentTool[] {
  const tools: AgentTool[] = [
    diskUsageTool,
    memoryInfoTool,
    systemUptimeTool,
    serviceStatusTool,
    dockerPsTool,
  ];

  // Opt-in escape hatch
  if (process.env.ENABLE_SHELL_TOOL === "true") {
    tools.push(runShellTool);
  }

  return tools;
}
```

**`src/agent.ts` — small update**

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { loadConfig } from "./config.js";
import { getTools } from "./tools.js";

export function createAgent(): Agent {
  const config = loadConfig();

  return new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: getTools(),
      thinkingLevel: "off",
      messages: [],
    },
    streamFn: streamSimple,
  });
}
```

Just swapped `allTools` for `getTools()`. The function call instead of constant lets us conditionally include the escape-hatch tool based on env vars.

**`src/config.ts` — system prompt update**

The system prompt should now reflect the new tool landscape:

```ts
import { getModel } from "@mariozechner/pi-ai";

export interface AppConfig {
  model: ReturnType<typeof getModel>;
  systemPrompt: string;
}

export function loadConfig(): AppConfig {
  const provider = process.env.MODEL_PROVIDER ?? "anthropic";
  const modelId = process.env.MODEL_ID ?? "claude-sonnet-4-5-20250929";

  if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  return {
    model: getModel(provider, modelId),
    systemPrompt: [
      "You are a homelab assistant with read-only access to the local system.",
      "",
      "You have specific tools for common diagnostics:",
      "- disk_usage: check disk space",
      "- memory_info: check RAM and swap",
      "- system_uptime: check uptime and load",
      "- service_status: check a systemd service",
      "- docker_ps: list Docker containers",
      "",
      "Prefer the narrow tools over generic shell commands. If no tool fits, " +
      "say so rather than guessing. Keep responses concise — these will be read " +
      "in a chat interface.",
    ].join("\n"),
  };
}
```

I also moved the API key sanity check from your homework here. The error messages now point at the actual problem instead of failing deep in pi-ai.

Notice the system prompt structure: it lists tools by name with terse descriptions, even though those descriptions are also in each tool's `description` field. This redundancy is intentional — the system prompt sets up "what kind of agent am I, what's my repertoire," while individual tool descriptions are what the model sees when deciding *which* tool to call. They serve different purposes.

**Run it:**

```bash
bun run repl
```

Try these queries to feel the difference:

```
how full is the main drive?
how much memory am I using?
is docker running?
what containers are up?
how long has the system been up?
```

Then try something off-piste:

```
can you delete old docker images?
```

The model should now refuse or ask for confirmation, because no tool fits — whereas before, `run_shell` would have happily executed `docker image prune` if the model was feeling bold.

---

**Things to notice while you're testing**

The model becomes more decisive. With one big shell tool, it sometimes "thinks out loud" before calling. With named tools that have specific descriptions, it tends to call the right tool immediately. Watch the first few turns — there's usually a noticeable improvement in directness.

Tool descriptions are doing real work. Each description includes "Use this when..." cues. These aren't just for humans reading the code — they're how the model decides which tool fits. If you find the model picking the wrong tool, the fix is almost always in the description, not the tool's logic. This is prompt engineering at the tool level.

Schema validation is dual-layer. The TypeBox schema tells the model what arguments to send. The runtime check inside `service_status` is paranoia — a defense against the model sending something unexpected anyway. For tools that touch the shell, runtime validation is non-negotiable. The schema is a hint to the model; runtime checks are the actual security boundary.

The escape hatch is gated. `ENABLE_SHELL_TOOL=true bun run repl` brings `run_shell` back. This pattern — "powerful but dangerous capability, off by default, opt in via env var" — is a useful one to internalize. We'll do the same thing in stage 10 when we add destructive actions.

The `runCommand` helper centralizes a bunch of cross-cutting concerns. When stage 6 adds retry logic or stage 8 adds OTel spans for tool execution, this is where they go. Each tool stays simple; the helper picks up the boilerplate. This is the same factory-pattern thinking we did with the agent.

---

**Homework, if you want it**

Add one more tool that fits *your* homelab specifically. Some ideas:

- `proxmox_vms()` if you run Proxmox — hits `qm list` over SSH or the API
- `pihole_stats()` if you run Pi-hole — fetches the JSON stats endpoint
- `check_url(url)` for uptime checks — good first tool that does something other than wrap a shell command
- `read_log(service, lines?)` — wraps `journalctl -u <service> -n <lines>`

The point isn't to build the Right tool — it's to feel what tool design is like when you have a specific need. Notice how much of the work is in the description, not the implementation.

When you're ready, say "stage 3" and we'll wire up structured logging. That's where things get visible.

## User

question on the tools.ts, why not separate them into different files under tools/?

## Claude

Good instinct. The honest answer: at five tools, one file is fine; at fifteen, it isn't. You're asking the right question slightly early, which is a good time to think about the criteria — splitting too early creates ceremony without benefit, splitting too late creates a 600-line file you don't want to open.

**When to split**

The signals that say "time to split":

The file has crossed roughly 200-300 lines and you're scrolling to find things. Pure ergonomics — when grep stops feeling fast, structure helps.

A tool grows beyond a thin command wrapper. Right now each tool is ~15 lines. When you add `proxmox_vms` that needs SSH config, retry logic, response parsing, and helper functions, that one tool might be 80 lines on its own. At that point it deserves its own file regardless of total count.

Tools start needing different dependencies. `docker_ps` shells out. A future `pihole_stats` would `fetch` an HTTP endpoint. A `proxmox_vms` would import an SSH library. When you find yourself with three different "kinds" of tool with non-overlapping imports, files-per-tool keeps each one's dependencies localized.

Multiple tools share helpers that are specific to a subsystem. If you write `docker_ps`, `docker_logs`, `docker_inspect`, they probably want to share a `dockerExec()` helper. That cluster wants to be a `tools/docker.ts` together.

Tests. Once you start writing tests per tool (and you will, around stage 9 when evals lead to wanting unit tests for tool logic), one-file-per-tool maps cleanly to one-test-file-per-tool.

**When not to split yet**

The signal that says "leave it alone":

Every tool is still a thin wrapper over `runCommand`. They're structurally identical, only the strings differ. Splitting these into files trades one screen of related code for navigating five files of nearly-identical code. That's worse, not better.

Tools share the registry. `getTools()` needs to import them all to assemble the list. With files-per-tool, that's five imports for five tools — fine, but pure overhead until the tools themselves are doing something interesting.

Discoverability matters. When everything is in `tools.ts`, a new contributor (or future-you) opens one file and sees the entire toolkit. That's genuinely valuable for a small project. Once it's spread across `tools/`, you need to know to look there and assemble the picture.

**What I'd actually do for your project**

Stay in one file for stage 2. The five tools as written total ~120 lines and they're structurally homogeneous. Splitting now would be ceremony.

Reach for the split the moment one of the conditions above hits. Concretely, I'd predict it happens around stage 5 or 6, when you start adding homelab-specific tools that have real logic. The natural target structure at that point looks something like:

```
src/tools/
├── index.ts          # registry: getTools()
├── shared.ts         # runCommand and other helpers
├── system.ts         # disk_usage, memory_info, system_uptime (cluster of similar)
├── docker.ts         # docker_ps, docker_logs, docker_inspect (subsystem cluster)
├── services.ts       # service_status, journalctl_read (subsystem cluster)
└── shell.ts          # run_shell escape hatch
```

Notice this isn't one-file-per-tool. It's one-file-per-cluster, where a cluster is "tools that share helpers and conceptual scope." Five files for ten tools is about the right ratio — each file is meaningful, none of them are trivially small.

The one-file-per-tool extreme is usually a smell. It implies each tool is so substantial it needs isolation, which is rare for tools that are mostly wrapping subsystem APIs. When I see `tools/disk_usage.ts` with twelve lines of code, my first thought is usually "this should be next to the other system tools."

**The general principle worth internalizing**

File organization is a tool for managing cognitive load, not a goal in itself. The right question isn't "should this be separate files," it's "when I come back to this code in three months, does the structure help me find what I need fast?" For five thin tools, one file helps. For fifteen tools across four subsystems, clusters help. For one giant tool with substantial logic, its own file helps.

Premature splitting is its own kind of complexity — it imposes a navigation tax that has to be repaid by genuine benefits. Wait until you feel the friction in the single-file version, then split *toward* the friction (cluster the parts that wanted to be together).

If you want to split *now* despite my advice, I won't fight you — it's a low-stakes choice and you'll learn something either way. The cluster structure above is how I'd suggest organizing it. But my honest read is that stage 2 isn't the moment yet. Save it for when the file actually feels heavy.

Want to move to stage 3 (structured logging)?

## User

i added read_log and was interesting to find out the model i was using wasnt up to the task and also found out if i wanted to see the actual tool output, i need to listen for tool_execution_end and combine the text entries

## Claude

Both of those discoveries are gold. They're exactly the kind of thing you can only learn by doing — no amount of reading docs gets you there. Let me unpack each because they connect to bigger ideas.

**The model failure**

This is one of the most important lessons in agent development, and you stumbled into it on day one: *model capability is part of your system design, not a parameter you tune at the end*. A tool that works perfectly with Claude Sonnet might be completely unusable with a smaller model. The tool didn't get worse — the reasoning required to use it got harder.

What probably happened with `read_log`: it has more cognitive load than the others. The model has to (a) figure out which service to query, (b) decide how many lines to ask for, (c) parse log output that might be hundreds of lines of unstructured text, (d) extract the relevant signal from noise, and (e) summarize without losing important details. Each step compounds. A model that handles `disk_usage` fine because the output is structured and small can fall apart on logs because the output is large and requires actual reading comprehension.

Common failure modes you might have seen:

The model asks for too few lines (5, 10) and misses the actual issue, then declares everything fine.

The model asks for too many lines (10000), gets a wall of text, and either summarizes it incorrectly or just bails out.

The model calls `read_log` with the wrong service name because it didn't first check what services exist.

The model reads the log, sees an error from three days ago, and reports it as current.

The model gets the log output and produces a summary that's wrong in subtle ways — wrong timestamps, wrong service mentioned, missed actual root cause.

Mitigations, in increasing order of effort:

*Better tool design.* Add structure to what comes back. Instead of returning raw `journalctl` output, parse it into `{entries: [{timestamp, level, message}], total_lines, errors_count, warnings_count}`. Now even a smaller model can answer "are there errors" without reading every line. The tool does the parsing work that the model would otherwise have to do imperfectly.

*Better tool descriptions.* "Use read_log when investigating a problem with a specific service. Default to 100 lines unless you have reason to look further. After reading, focus on ERROR and WARNING level entries first." Tool descriptions can include heuristics that compensate for weaker reasoning.

*Constrain the parameters.* Make the tool only return errors and warnings by default, with a flag to get verbose output. Smaller models do better when the easy path is also the right path.

*Use a stronger model for the agent loop.* Sometimes the answer is just "this is a Sonnet-class problem, not a Haiku-class problem." Knowing where that threshold is for *your* tools is a real skill.

*Two-tier model setup.* The agent uses a fast cheap model for orchestration, but specific tools that need reasoning over their output internally call a stronger model. So `read_log` could fetch the logs and then internally summarize with Sonnet before returning. The orchestrator never sees the raw 500 lines. This pattern shows up in production agents constantly.

The general insight: **models and tools are co-designed**. You can't separate "is this a good tool" from "is this a good tool for this model." When you start running evals in stage 9, you'll formalize this — the same eval set against different models will show you exactly which tools are model-sensitive.

**The streaming discovery**

The other thing you learned is more subtle and worth dwelling on. The agent emits a stream of fine-grained events — `text_delta` for each chunk of model output, `tool_call_start`, `tool_execution_start`, `tool_execution_end`, etc. Your REPL was only listening for `text_delta`, which is why you saw the model's prose but not the tool *results*.

This is actually the right default for a chat REPL — you want to see the model talking, not the tool internals. But for *understanding* what your agent is doing (i.e., observability), you want everything.

The mental model: pi-agent-core's event stream is a structured trace of the agent's internal state changes. Different consumers want different views:

A **chat UI** consumer wants the model's text deltas streamed in real time, plus maybe an indicator that "the agent is using a tool right now" while a tool call runs. It doesn't show tool outputs.

A **debug REPL** consumer wants everything — text, tool calls with arguments, tool results, errors. Probably color-coded so you can visually parse the flow.

A **logger** (what we're building in stage 3) wants the structured events written to disk for later analysis, but doesn't render anything to a terminal.

A **metrics consumer** only cares about specific events: count tool calls, sum tokens, measure latency. Ignores text content entirely.

These are all the same `subscribe()` callback with different filtering and different output. The fact that pi-agent-core gives you fine-grained events instead of a high-level "here's the answer" callback is the architectural thing that *enables* observability. If the only output were the final response, you couldn't build any of the above.

Worth a small refactor right now to make this visible. Add a debug mode to your REPL that shows tool activity:

```ts
const DEBUG = process.env.DEBUG === "true";

agent.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }

  if (DEBUG) {
    if (event.type === "tool_execution_start") {
      process.stdout.write(
        `\n[tool] ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})\n`,
      );
    }
    if (event.type === "tool_execution_end") {
      const resultStr = JSON.stringify(event.result).slice(0, 500);
      process.stdout.write(`\n[result] ${resultStr}\n`);
    }
  }
});
```

Run with `DEBUG=true bun run repl` and you'll see the full play-by-play. Run without and it's a clean chat. Same agent, same subscription, different filtering.

(Check the actual event type names against pi-agent-core's types — I'm working from memory here. The pattern is what matters; the exact names might be `tool_use_start` / `tool_use_end` or similar.)

**Why this matters for stage 3**

The structured logger we're about to build is the same pattern, taken further. It subscribes to *every* event, transforms each into a JSONL line with trace IDs and metadata, and appends to a file. Once that's running, you have multiple consumers of the same event stream:

- The REPL (renders text to terminal)
- The debug overlay (renders tool activity to terminal when enabled)
- The logger (writes structured events to disk)
- Eventually: the OTel exporter (creates spans), the metrics aggregator (counts things)

All of them get their data by subscribing to the same agent. None of them know about each other. This is good architecture — the agent emits events, consumers decide what they care about. You can add or remove consumers without touching the agent.

The thing you accidentally proved by needing `tool_execution_end`: the *structure* of agent observability isn't a feature the agent owes you. It's a property of how the agent emits information. Pi-agent-core's choice to emit fine-grained events is what makes the rest of stage 3-8 possible. A library that just gave you `agent.run(input).then(answer)` would be unobservable.

This is also a lesson for evaluating future tools and frameworks at work: *can I see what's happening inside this thing?* If the answer is "you get the final result," walk away. If the answer is "you can subscribe to a structured event stream," you have something you can actually build on.

Ready for stage 3? You're already well-primed for it — half the work of structured logging is just routing this same event stream to a file with the right metadata, and you've now seen firsthand why that's valuable.

## User

yes lets move on to stage 3, remember im working with bun

## Claude

Good — you're well-primed for this. Stage 3 is mostly plumbing, but the plumbing is the foundation everything else sits on. Let's build it deliberately.

## Stage 3: Structured JSONL logging

**The mental model going in**

We're going to subscribe to the agent's event stream (the same stream you've already used for `text_delta` and `tool_execution_end`), translate each interesting event into a structured JSON record, and append it to a file. Each user interaction gets a `trace_id` that ties all its events together. After running for a while, you'll have a file that's queryable with `jq`, `duckdb`, or anything that reads JSONL.

The non-obvious work isn't in the file I/O — it's in defining the event schema. What fields do you log on a tool call? On an LLM call? On the final response? Get this right and your future analyses are easy. Get it wrong and you're rewriting the logger in three months when you realize you forgot to log something important.

**Event schema design**

Every log entry shares this skeleton:

```ts
{
  timestamp: string,        // ISO 8601, with milliseconds
  trace_id: string,         // shared across all events in one user interaction
  user_id: string,          // future-proofing for Discord (multiple users)
  event_type: string,       // what kind of thing happened
  data: { ... },            // event-specific payload
  metadata?: { ... },       // optional extras (latency, sizes, etc.)
}
```

The event types we'll capture for now:

- `user_message` — user said something to the agent
- `llm_call_start` — agent is about to call the model
- `llm_call_end` — model responded (with token usage)
- `tool_call` — tool was invoked (combining call + result for now)
- `agent_response` — agent finished its turn (with totals)
- `error` — something went wrong

This is deliberately a smaller set than what pi-agent-core emits. The raw event stream has more granular events (per-token deltas, internal state transitions); we're aggregating up to a level that's useful for analysis without being overwhelming. You can always add more event types later.

**File structure**

```
src/
├── observability/
│   ├── logger.ts          # the AgentLogger class
│   └── types.ts           # event type definitions
├── agent.ts               # updated to wire the logger in
├── config.ts
├── repl.ts
└── tools.ts
```

Putting observability under its own folder because stage 8 (OTel) and a future metrics aggregator will live alongside this. Treating observability as a subsystem from the start.

**`src/observability/types.ts`**

```ts
export interface BaseEvent {
  timestamp: string;
  trace_id: string;
  user_id: string;
  event_type: string;
}

export interface UserMessageEvent extends BaseEvent {
  event_type: "user_message";
  data: {
    content: string;
    content_length: number;
  };
}

export interface LlmCallStartEvent extends BaseEvent {
  event_type: "llm_call_start";
  data: {
    model: string;
    message_count: number;
    turn_index: number; // which LLM call within this trace (0, 1, 2, ...)
  };
}

export interface LlmCallEndEvent extends BaseEvent {
  event_type: "llm_call_end";
  data: {
    model: string;
    turn_index: number;
    input_tokens?: number;
    output_tokens?: number;
    duration_ms: number;
    finish_reason?: string;
  };
}

export interface ToolCallEvent extends BaseEvent {
  event_type: "tool_call";
  data: {
    tool_name: string;
    arguments: Record<string, unknown>;
    result_preview: string; // truncated for log size
    result_size_bytes: number;
    duration_ms: number;
    success: boolean;
    error?: string;
  };
}

export interface AgentResponseEvent extends BaseEvent {
  event_type: "agent_response";
  data: {
    response_text: string;
    total_llm_calls: number;
    total_tool_calls: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_duration_ms: number;
  };
}

export interface ErrorEvent extends BaseEvent {
  event_type: "error";
  data: {
    where: string;
    message: string;
    stack?: string;
  };
}

export type AgentEvent =
  | UserMessageEvent
  | LlmCallStartEvent
  | LlmCallEndEvent
  | ToolCallEvent
  | AgentResponseEvent
  | ErrorEvent;
```

This looks like a lot, but each interface is just a typed schema for one log entry shape. The discriminated union (`AgentEvent`) means TypeScript will help you anywhere you handle these events later — autocomplete, exhaustiveness checks, the works. Worth the upfront types.

**`src/observability/logger.ts`**

```ts
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "./types.js";

export class AgentLogger {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private path: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
  }

  newTraceId(): string {
    return randomUUID();
  }

  log(event: AgentEvent): void {
    // Serialize writes so concurrent calls don't interleave bytes.
    // We don't await this — fire-and-forget so logging doesn't block the agent.
    this.writeQueue = this.writeQueue.then(async () => {
      const line = JSON.stringify(event) + "\n";
      const file = Bun.file(this.path);
      const existing = (await file.exists()) ? await file.text() : "";
      await Bun.write(this.path, existing + line);
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }
}
```

Wait — that `existing + line` approach reads the whole file every write. That works for a toy but it'll get slow fast. Let me give you the real version using Bun's append-mode file API:

```ts
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "./types.js";

export class AgentLogger {
  private writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private path: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Bun's writer with append flag - opens once, writes many.
    this.writer = Bun.file(this.path).writer();
  }

  newTraceId(): string {
    return randomUUID();
  }

  log(event: AgentEvent): void {
    if (!this.writer) {
      throw new Error("AgentLogger.init() must be called before log()");
    }
    const line = JSON.stringify(event) + "\n";
    // Sequential writes via promise chain to avoid interleaving.
    this.writeQueue = this.writeQueue.then(async () => {
      this.writer!.write(line);
      await this.writer!.flush();
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.writer?.end();
  }
}
```

A note on the design: `log()` is intentionally synchronous-looking (returns void, not a Promise) but the actual write happens asynchronously in the background. This is the right shape — your agent code shouldn't have to `await` every log call. The `flush()` and `close()` methods exist for when you actually need to be sure everything's persisted (graceful shutdown, before reading the file in tests).

If pi-agent-core or Bun has a more idiomatic file-append pattern, use that — the principle is what matters. Don't read the whole file on every write.

**The bridge: subscribing to agent events and producing log events**

This is where the design choices show up. The agent emits events at a different granularity than what we want to log. Some agent events become log events directly, some get aggregated, some get ignored.

**`src/observability/agent-subscriber.ts`**

```ts
import type { Agent } from "@mariozechner/pi-agent-core";
import type { AgentLogger } from "./logger.js";

interface TurnState {
  trace_id: string;
  user_id: string;
  turn_started_at: number;
  llm_call_index: number;
  llm_call_started_at: number | null;
  pending_tool_calls: Map<string, { name: string; arguments: any; started_at: number }>;
  totals: {
    llm_calls: number;
    tool_calls: number;
    input_tokens: number;
    output_tokens: number;
  };
  response_buffer: string;
}

export function attachLogger(
  agent: Agent,
  logger: AgentLogger,
  getContext: () => { trace_id: string; user_id: string; model: string },
): () => void {
  let state: TurnState | null = null;

  const unsubscribe = agent.subscribe((event) => {
    const ctx = getContext();
    const now = Date.now();
    const baseEvent = {
      timestamp: new Date().toISOString(),
      trace_id: ctx.trace_id,
      user_id: ctx.user_id,
    };

    // Lazily initialize state on first event of a turn.
    if (!state || state.trace_id !== ctx.trace_id) {
      state = {
        trace_id: ctx.trace_id,
        user_id: ctx.user_id,
        turn_started_at: now,
        llm_call_index: 0,
        llm_call_started_at: null,
        pending_tool_calls: new Map(),
        totals: { llm_calls: 0, tool_calls: 0, input_tokens: 0, output_tokens: 0 },
        response_buffer: "",
      };
    }

    // NOTE: Event names below are placeholders — verify against pi-agent-core's
    // actual event types. The shape of the handling is what matters.
    switch (event.type) {
      case "llm_call_start": {
        state.llm_call_started_at = now;
        logger.log({
          ...baseEvent,
          event_type: "llm_call_start",
          data: {
            model: ctx.model,
            message_count: event.messageCount ?? 0,
            turn_index: state.llm_call_index,
          },
        });
        break;
      }
      case "llm_call_end": {
        const duration_ms = now - (state.llm_call_started_at ?? now);
        const inputTokens = event.usage?.inputTokens ?? 0;
        const outputTokens = event.usage?.outputTokens ?? 0;
        state.totals.llm_calls++;
        state.totals.input_tokens += inputTokens;
        state.totals.output_tokens += outputTokens;
        logger.log({
          ...baseEvent,
          event_type: "llm_call_end",
          data: {
            model: ctx.model,
            turn_index: state.llm_call_index,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            duration_ms,
            finish_reason: event.finishReason,
          },
        });
        state.llm_call_index++;
        state.llm_call_started_at = null;
        break;
      }
      case "tool_execution_start": {
        state.pending_tool_calls.set(event.toolCall.id, {
          name: event.toolCall.name,
          arguments: event.toolCall.arguments,
          started_at: now,
        });
        break;
      }
      case "tool_execution_end": {
        const pending = state.pending_tool_calls.get(event.toolCall.id);
        const started_at = pending?.started_at ?? now;
        const resultJson = JSON.stringify(event.result ?? {});
        state.totals.tool_calls++;
        logger.log({
          ...baseEvent,
          event_type: "tool_call",
          data: {
            tool_name: event.toolCall.name,
            arguments: event.toolCall.arguments,
            result_preview: resultJson.slice(0, 500),
            result_size_bytes: resultJson.length,
            duration_ms: now - started_at,
            success: !event.error,
            error: event.error?.message,
          },
        });
        state.pending_tool_calls.delete(event.toolCall.id);
        break;
      }
      case "message_update": {
        if (event.assistantMessageEvent?.type === "text_delta") {
          state.response_buffer += event.assistantMessageEvent.delta;
        }
        break;
      }
      case "agent_end": {
        const duration_ms = now - state.turn_started_at;
        logger.log({
          ...baseEvent,
          event_type: "agent_response",
          data: {
            response_text: state.response_buffer,
            total_llm_calls: state.totals.llm_calls,
            total_tool_calls: state.totals.tool_calls,
            total_input_tokens: state.totals.input_tokens,
            total_output_tokens: state.totals.output_tokens,
            total_duration_ms: duration_ms,
          },
        });
        state = null; // ready for next turn
        break;
      }
    }
  });

  return unsubscribe;
}
```

A few things to call out about this code:

I'm guessing at some pi-agent-core event names and shapes (`event.usage?.inputTokens`, `event.toolCall.id`, etc.). When you wire this up, you'll need to adjust to match what the library actually emits. Run the agent once with `console.log(JSON.stringify(event))` in the subscribe callback to see the exact shapes, then refine. This is itself a useful exercise — it forces you to actually look at the event stream.

The `getContext` parameter is a callback that returns the current trace/user context. We need this because trace IDs are per-user-message, not per-agent — the agent stays alive across many turns. The frontend (REPL, Discord) tells the logger "what's the current context" via this callback.

State accumulates within a turn and resets on `agent_end`. This is the bridge between fine-grained agent events and coarse-grained log events. The aggregation (totaling tokens, counting tool calls) happens here, not in the logger.

The buffer for the response text is necessary because text comes in as deltas. We accumulate them so the final `agent_response` event has the complete response captured. You already noticed this pattern with tool outputs.

**Wiring it into the agent factory**

**`src/agent.ts`**

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { loadConfig } from "./config.js";
import { getTools } from "./tools.js";
import { AgentLogger } from "./observability/logger.js";
import { attachLogger } from "./observability/agent-subscriber.js";

export interface AgentBundle {
  agent: Agent;
  logger: AgentLogger;
  setContext: (ctx: { trace_id: string; user_id: string }) => void;
  newTraceId: () => string;
}

export async function createAgent(userId = "local"): Promise<AgentBundle> {
  const config = loadConfig();

  const logger = new AgentLogger("./data/events.jsonl");
  await logger.init();

  const agent = new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: getTools(),
      thinkingLevel: "off",
      messages: [],
    },
    streamFn: streamSimple,
  });

  let currentContext = {
    trace_id: logger.newTraceId(),
    user_id: userId,
  };

  attachLogger(agent, logger, () => ({
    ...currentContext,
    model: `${process.env.MODEL_PROVIDER ?? "anthropic"}/${
      process.env.MODEL_ID ?? "claude-sonnet-4-5-20250929"
    }`,
  }));

  return {
    agent,
    logger,
    setContext: (ctx) => {
      currentContext = ctx;
    },
    newTraceId: () => logger.newTraceId(),
  };
}
```

The factory now returns a bundle: the agent, the logger, plus helpers for managing trace context. The frontend is responsible for calling `setContext` with a fresh `trace_id` before each user message. This keeps the trace lifecycle explicit rather than magical.

**Updated REPL**

**`src/repl.ts`**

```ts
import * as readline from "node:readline/promises";
import { createAgent } from "./agent.js";

async function main() {
  const bundle = await createAgent("local");
  const { agent, logger } = bundle;

  const DEBUG = process.env.DEBUG === "true";

  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }

    if (DEBUG) {
      if (event.type === "tool_execution_start") {
        process.stdout.write(
          `\n[tool] ${event.toolCall.name}(${JSON.stringify(event.toolCall.arguments)})\n`,
        );
      }
      if (event.type === "tool_execution_end") {
        const r = JSON.stringify(event.result ?? {}).slice(0, 300);
        process.stdout.write(`\n[result] ${r}\n`);
      }
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("homelab-agent REPL. Ctrl-C to quit.");
  console.log(`Logging to ./data/events.jsonl${DEBUG ? " (DEBUG mode)" : ""}\n`);

  // Graceful shutdown — flush logs before exit
  const shutdown = async () => {
    process.stdout.write("\nshutting down...\n");
    await logger.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    const input = await rl.question("\nyou> ");
    if (!input.trim()) continue;

    // Start a new trace for this user message
    const trace_id = bundle.newTraceId();
    bundle.setContext({ trace_id, user_id: "local" });
    logger.log({
      timestamp: new Date().toISOString(),
      trace_id,
      user_id: "local",
      event_type: "user_message",
      data: { content: input, content_length: input.length },
    });

    process.stdout.write("\nagent> ");
    try {
      await agent.prompt(input);
    } catch (err: any) {
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id,
        user_id: "local",
        event_type: "error",
        data: { where: "agent.prompt", message: err.message, stack: err.stack },
      });
      console.error(`\n[error] ${err.message}`);
    }
    process.stdout.write("\n");
  }
}

main();
```

The REPL is still small. The new pieces: it asks the bundle for a fresh trace ID before each prompt, sets context, logs the user message manually (since pi-agent-core doesn't know about user messages until they're in the agent), and handles graceful shutdown so the log file gets flushed.

The `text_delta` and DEBUG handlers are duplicated between `repl.ts` and the logger subscriber, and that's fine — they're rendering, the logger is recording. Different jobs.

**Try it**

```bash
mkdir -p data
bun run repl
```

Have a few conversations:

```
how full is the main drive?
how much memory am I using?
what containers are running?
```

Then in another terminal, look at what got logged:

```bash
# Pretty-print everything
cat data/events.jsonl | jq

# Just the event types in order
cat data/events.jsonl | jq -r '.event_type'

# Tool usage distribution
cat data/events.jsonl | jq -r 'select(.event_type=="tool_call") | .data.tool_name' | sort | uniq -c

# Per-trace summary: what did each user message produce?
cat data/events.jsonl | jq 'select(.event_type=="agent_response") | {trace_id, llm_calls: .data.total_llm_calls, tools: .data.total_tool_calls, tokens: (.data.total_input_tokens + .data.total_output_tokens), ms: .data.total_duration_ms}'

# All events for a specific trace, in order
TRACE_ID=...  # from above
cat data/events.jsonl | jq --arg tid "$TRACE_ID" 'select(.trace_id==$tid)'
```

This is the moment where the work pays off. You can now look at any past interaction and see exactly what happened: what the user said, which model calls were made, how long each took, which tools fired with what arguments and what they returned, how many tokens were burned, where any errors occurred.

**Try DuckDB too**

If you have it (`brew install duckdb` or similar), this is where things get fun:

```bash
duckdb -c "SELECT event_type, COUNT(*) FROM read_json_auto('data/events.jsonl') GROUP BY event_type"

duckdb -c "
SELECT
  data->>'tool_name' AS tool,
  COUNT(*) AS calls,
  AVG((data->>'duration_ms')::DOUBLE) AS avg_ms,
  AVG((data->>'result_size_bytes')::DOUBLE) AS avg_bytes
FROM read_json_auto('data/events.jsonl')
WHERE event_type = 'tool_call'
GROUP BY tool
ORDER BY calls DESC
"
```

You're now doing real analytics on agent behavior with zero infrastructure. This is the same shape of data and analysis you'd want at work; you just have a one-person dataset instead of a million-user one.

---

**What to actually verify before moving on**

Once you have it running, spend 15 minutes here. The point of stage 3 isn't the code, it's the visibility. Use it.

A few specific things to check:

Run a query that *should* call multiple tools ("how's my system doing — disk, memory, and uptime"). Look at the trace. Did the model call all three? In what order? Did it get the right ones?

Deliberately break a tool: temporarily change `disk_usage` to throw an error. See what the log records. Does the `tool_call` event correctly capture `success: false` and the error message? Does the agent recover gracefully?

Look at total_input_tokens for a multi-turn conversation. Watch it grow each turn — that's the conversation history accumulating. This is the problem we'll address in stage 7 (context management). Now you can see it concretely instead of theoretically.

Find a slow turn (high total_duration_ms). Pull up its full trace. Where did the time go? Was it the LLM thinking, or a slow tool? This is exactly the diagnostic capability that's invaluable in production.

---

**Things to notice about the design**

The trace_id flows from the frontend down. The REPL generates it, sets it via `setContext`, and the logger picks it up via the `getContext` callback. The agent itself doesn't know about traces — it just emits events. This separation means you could swap in a different frontend (Discord) and trace IDs would still work. It also means the same agent could serve multiple users with separate traces, which we'll need in stage 5.

The logger is a write-only sink. It doesn't care who's writing or what they're writing — it just structures and persists. The subscriber is the thing that knows about agent semantics. This separation lets us add another sink later (the OTel exporter in stage 8) without changing the subscriber.

You'll notice some events from pi-agent-core are getting ignored (per-token deltas, internal state transitions). That's intentional. Logging every delta would be enormous and not useful for analysis. Logging the aggregates (`total_output_tokens`) gives you what you actually want to query. The right log granularity is "the smallest unit of analysis you'd ever want," not "everything that happens."

The fire-and-forget log writes mean the agent never blocks on I/O. This matters more than it sounds — if the disk is slow or full, your agent shouldn't grind to a halt waiting on the logger. The downside is that a crash mid-write could lose the last few events. For a homelab bot that's fine. For production, you'd want either synchronous writes for critical events or a write-ahead-log pattern.

---

**Homework, if you want it**

Two suggestions, depending on what you're curious about:

The "real shapes" exercise: temporarily add `console.log("EVENT:", JSON.stringify(event, null, 2))` inside the agent subscriber and run a few prompts. Capture the full output to a file. Now you have ground truth for what pi-agent-core actually emits. Compare to my guesses in `agent-subscriber.ts` and fix anything wrong. This is genuinely how you'd onboard to any agent library at work — read the docs, then verify against actual emitted events.

The "real query" exercise: think of a question you'd want to answer about your agent's behavior — something specific. Examples: "What's my p95 latency?" "Do certain prompts consistently use more tokens?" "What's the average tool calls per response?" Write the `jq` or DuckDB query that answers it. The skill of formulating analytical questions and translating them to queries is the actual skill — the dashboards and tools come later.

When you're ready, say "stage 4" and we'll add persistence so conversations survive restarts.

## User

can you take a look at the real pi events and help me figure out what to change? https://github.com/badlogic/pi-mono

## Claude

Yes, let me dig into the actual source.

Got the directory layout. The agent package is at `packages/agent`. Let me grab the actual source.

The raw URLs aren't reachable directly via web_fetch unless they came from a search result. Let me search for the source.

Got the real shapes. The key thing I had wrong: tool events use `toolName`, `toolCallId`, `args`, and `result` (with `isError` flag) — *not* a nested `toolCall` object. And there are turn-level events (`turn_start`, `turn_end`) we should use instead of trying to hand-roll the LLM-call-start/end timing. Let me also confirm where token usage lives.

Now I have ground truth. Here's a summary of what I had wrong and what to change:

## What the actual events look like

The full event union from pi-agent-core:

```ts
type AgentEvent =
  // Agent lifecycle
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  // Turn lifecycle (one LLM response + its tool calls)
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  // Message lifecycle
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  // Tool execution
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };
```

## What I had wrong

**The big one: there's no `llm_call_start` / `llm_call_end` event.** The event named `llm_call_start` does not exist. Pi uses `turn_start` / `turn_end` for "one LLM response + the tool calls that came from it." That's the correct boundary for what I was calling "an LLM call." This is actually a cleaner abstraction than what I sketched — a "turn" is the natural unit because it groups the model response with the tools it triggered.

**Tool event field names.** I had `event.toolCall.name`, `event.toolCall.id`, `event.toolCall.arguments`, and `event.result`. The real fields are:
- `toolName` (not `toolCall.name`)
- `toolCallId` (not `toolCall.id`)
- `args` (not `arguments` — and not nested inside `toolCall`)
- `result` (correct) and `isError` (boolean flag, not an `error` object)

**Token usage doesn't come on a tool/turn event.** Tokens live on `AssistantMessage.usage` after streaming completes. The right place to read tokens is in `message_end` when `message.role === "assistant"`. That message has a `usage` field (input, output, cacheRead, cacheWrite). The `agent_end` event gives you the full final message array, so you can also tally there.

**Argument types are `any`.** Not the typed objects I implied.

## The corrected subscriber

Here's the rewritten `src/observability/agent-subscriber.ts`. I'm also collapsing the schema to match: there's no `llm_call_start`/`llm_call_end` log event anymore — there's `turn_start`/`turn_end` instead.

First the updated types:

**`src/observability/types.ts`**

```ts
export interface BaseEvent {
  timestamp: string;
  trace_id: string;
  user_id: string;
  event_type: string;
}

export interface UserMessageEvent extends BaseEvent {
  event_type: "user_message";
  data: {
    content: string;
    content_length: number;
  };
}

export interface TurnStartEvent extends BaseEvent {
  event_type: "turn_start";
  data: {
    turn_index: number;
    model: string;
  };
}

export interface TurnEndEvent extends BaseEvent {
  event_type: "turn_end";
  data: {
    turn_index: number;
    model: string;
    duration_ms: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    tool_calls_in_turn: number;
    finish_reason?: string;
  };
}

export interface ToolCallEvent extends BaseEvent {
  event_type: "tool_call";
  data: {
    tool_call_id: string;
    tool_name: string;
    args: unknown;
    result_preview: string;
    result_size_bytes: number;
    duration_ms: number;
    is_error: boolean;
  };
}

export interface AgentResponseEvent extends BaseEvent {
  event_type: "agent_response";
  data: {
    response_text: string;
    total_turns: number;
    total_tool_calls: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_read_tokens: number;
    total_cache_write_tokens: number;
    total_duration_ms: number;
  };
}

export interface ErrorEvent extends BaseEvent {
  event_type: "error";
  data: {
    where: string;
    message: string;
    stack?: string;
  };
}

export type LogEvent =
  | UserMessageEvent
  | TurnStartEvent
  | TurnEndEvent
  | ToolCallEvent
  | AgentResponseEvent
  | ErrorEvent;
```

I renamed the union from `AgentEvent` to `LogEvent` because pi already has an `AgentEvent` type and we don't want the name collision. Update `logger.ts` to import `LogEvent` instead of `AgentEvent`.

**`src/observability/agent-subscriber.ts` (rewritten)**

```ts
import type { Agent } from "@mariozechner/pi-agent-core";
import type { AgentLogger } from "./logger.js";

interface TurnState {
  turn_index: number;
  turn_started_at: number;
  tool_calls_in_turn: number;
  pending_tool_starts: Map<string, number>; // toolCallId -> startedAt
}

interface TraceState {
  trace_id: string;
  user_id: string;
  agent_started_at: number;
  current_turn: TurnState | null;
  totals: {
    turns: number;
    tool_calls: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
  response_buffer: string;
}

export function attachLogger(
  agent: Agent,
  logger: AgentLogger,
  getContext: () => { trace_id: string; user_id: string; model: string },
): () => void {
  let trace: TraceState | null = null;

  const unsubscribe = agent.subscribe((event) => {
    const ctx = getContext();
    const now = Date.now();
    const baseEvent = {
      timestamp: new Date().toISOString(),
      trace_id: ctx.trace_id,
      user_id: ctx.user_id,
    };

    switch (event.type) {
      case "agent_start": {
        trace = {
          trace_id: ctx.trace_id,
          user_id: ctx.user_id,
          agent_started_at: now,
          current_turn: null,
          totals: {
            turns: 0,
            tool_calls: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
          response_buffer: "",
        };
        break;
      }

      case "turn_start": {
        if (!trace) break;
        trace.current_turn = {
          turn_index: trace.totals.turns,
          turn_started_at: now,
          tool_calls_in_turn: 0,
          pending_tool_starts: new Map(),
        };
        logger.log({
          ...baseEvent,
          event_type: "turn_start",
          data: {
            turn_index: trace.current_turn.turn_index,
            model: ctx.model,
          },
        });
        break;
      }

      case "message_update": {
        // Accumulate text deltas for the final response buffer.
        if (
          trace &&
          event.assistantMessageEvent?.type === "text_delta" &&
          typeof event.assistantMessageEvent.delta === "string"
        ) {
          trace.response_buffer += event.assistantMessageEvent.delta;
        }
        break;
      }

      case "message_end": {
        // Pull token usage off completed assistant messages.
        if (!trace) break;
        const msg = event.message as any;
        if (msg?.role === "assistant" && msg.usage) {
          trace.totals.input_tokens += msg.usage.input ?? 0;
          trace.totals.output_tokens += msg.usage.output ?? 0;
          trace.totals.cache_read_tokens += msg.usage.cacheRead ?? 0;
          trace.totals.cache_write_tokens += msg.usage.cacheWrite ?? 0;
        }
        break;
      }

      case "tool_execution_start": {
        if (!trace?.current_turn) break;
        trace.current_turn.pending_tool_starts.set(event.toolCallId, now);
        break;
      }

      case "tool_execution_end": {
        if (!trace?.current_turn) break;
        const startedAt =
          trace.current_turn.pending_tool_starts.get(event.toolCallId) ?? now;
        trace.current_turn.pending_tool_starts.delete(event.toolCallId);
        trace.current_turn.tool_calls_in_turn++;
        trace.totals.tool_calls++;

        const resultJson = JSON.stringify(event.result ?? {});
        logger.log({
          ...baseEvent,
          event_type: "tool_call",
          data: {
            tool_call_id: event.toolCallId,
            tool_name: event.toolName,
            args: event.args,
            result_preview: resultJson.slice(0, 500),
            result_size_bytes: resultJson.length,
            duration_ms: now - startedAt,
            is_error: event.isError,
          },
        });
        break;
      }

      case "turn_end": {
        if (!trace || !trace.current_turn) break;
        const turn = trace.current_turn;
        const duration_ms = now - turn.turn_started_at;

        // Tokens for this specific turn aren't directly carried on turn_end —
        // we read assistant usage in message_end. To get per-turn tokens we
        // snapshot totals at turn boundaries; for now we report cumulative
        // tokens, which is fine for the dataset shape we want.
        logger.log({
          ...baseEvent,
          event_type: "turn_end",
          data: {
            turn_index: turn.turn_index,
            model: ctx.model,
            duration_ms,
            input_tokens: trace.totals.input_tokens,
            output_tokens: trace.totals.output_tokens,
            cache_read_tokens: trace.totals.cache_read_tokens,
            cache_write_tokens: trace.totals.cache_write_tokens,
            tool_calls_in_turn: turn.tool_calls_in_turn,
          },
        });

        trace.totals.turns++;
        trace.current_turn = null;
        break;
      }

      case "agent_end": {
        if (!trace) break;
        const total_duration_ms = now - trace.agent_started_at;
        logger.log({
          ...baseEvent,
          event_type: "agent_response",
          data: {
            response_text: trace.response_buffer,
            total_turns: trace.totals.turns,
            total_tool_calls: trace.totals.tool_calls,
            total_input_tokens: trace.totals.input_tokens,
            total_output_tokens: trace.totals.output_tokens,
            total_cache_read_tokens: trace.totals.cache_read_tokens,
            total_cache_write_tokens: trace.totals.cache_write_tokens,
            total_duration_ms,
          },
        });
        trace = null;
        break;
      }
    }
  });

  return unsubscribe;
}
```

## Key design changes worth understanding

**Use `agent_start`/`agent_end` as the trace lifecycle boundary.** Not the user message in the REPL. The REPL still logs the `user_message` event explicitly when it gets input — that's fine — but state initialization happens on `agent_start`. This means you don't need `setContext` to be called in any specific order with `prompt()`; the subscriber resets state cleanly per agent run.

**`turn_start`/`turn_end` is the real boundary for "an LLM exchange."** Each turn is one model response plus the tool calls that came from it. If the agent calls 3 tools in parallel, that's all one turn. If the model responds with no tool calls, that's a turn too. The agent might do multiple turns within a single `prompt()` call (model says "let me check disk, then memory" → turn 1 = tool calls → turn 2 = final summary). This nesting is exactly what you want to see in observability.

**Tokens come from `message_end`, not from any "LLM call ended" event.** Because pi-ai gets usage data from the streaming response, the canonical place to read it is on the finalized `AssistantMessage`. That message has `usage: { input, output, cacheRead, cacheWrite }`. We accumulate into trace totals as messages complete.

**The cache token fields are useful.** Anthropic and OpenAI both support prompt caching, where you pay less for repeated input. Tracking `cacheRead` vs `input` separately lets you see how well caching is working — a long conversation should have rising `cacheRead` and stable `input`. Worth logging from day one.

**Cumulative-vs-per-turn tokens.** I'm logging cumulative totals on `turn_end` rather than per-turn deltas. You can derive per-turn from consecutive `turn_end` events with `jq`, but if you want per-turn directly, snapshot totals at `turn_start` and subtract on `turn_end`. Small change if you want it.

## Things to verify on your end

A few specifics I'm still inferring:

The exact field name for token usage on `AssistantMessage`. I used `msg.usage.input` / `msg.usage.output` / `msg.usage.cacheRead` / `msg.usage.cacheWrite` based on the pi-coding-agent docs that show `tokens: { input, output, cacheRead, cacheWrite, total }`. The shape might be slightly different on the message itself (e.g., `inputTokens` vs `input`). Run with the `EVENT:` console.log debugging hack on `message_end` events and adjust:

```ts
if (event.type === "message_end" && (event.message as any)?.role === "assistant") {
  console.log("ASSISTANT MSG:", JSON.stringify(event.message, null, 2));
}
```

Whether `event.assistantMessageEvent` is always present on `message_update`. Looks like yes for assistant message updates, but worth checking with the same debug hack — print full events for a few turns and you'll know exactly.

Whether `args` on tool events comes through as already-parsed JSON (object) or as a string. Probably an object based on the type signature, but worth confirming with a real run.

## What this teaches

The bigger lesson hiding inside this exercise: when adapting to a real library, the *shape* of its event model usually carries design wisdom that's worth understanding before you start filtering. Pi's choice to use `turn_start`/`turn_end` rather than `llm_call_start`/`llm_call_end` reflects a real insight — a turn is the natural unit of agent behavior because it groups model output with the actions that output triggered. My original sketch was modeling LLM calls in isolation, which would have given you a less useful trace structure.

So when you adapt my code, don't just rename fields. Notice that the event taxonomy itself changed slightly, and the schema follows. This is the kind of thing that comes up constantly in real work — you sketch an architecture against an imagined library, then the actual library has its own opinions, and the right move is to adopt those opinions when they're better, not to force your sketch through.

Once you've wired this up and confirmed it works against a real run, say "stage 4" and we'll add persistence.

## User

one thing im unable to get is the tool args on tool_execution_end since they dont exist in that event according to the pi-mono code. how would you recommend i change that bit?

## Claude

Good catch — you read the source more carefully than I did. Looking at the actual type, `tool_execution_end` only carries `toolCallId`, `toolName`, `result`, and `isError`. The args are emitted in `tool_execution_start` and assumed to be correlated by `toolCallId`.

That correlation is exactly the pattern: track args at `start`, look them up at `end`. You're already doing this for the start timestamp — extend the same map to also hold the args.

Here's the change. Update the `TurnState` interface to track args alongside timing:

```ts
interface TurnState {
  turn_index: number;
  turn_started_at: number;
  tool_calls_in_turn: number;
  pending_tool_calls: Map<string, { started_at: number; args: unknown }>;
}
```

Then in `tool_execution_start`, store both:

```ts
case "tool_execution_start": {
  if (!trace?.current_turn) break;
  trace.current_turn.pending_tool_calls.set(event.toolCallId, {
    started_at: now,
    args: event.args,
  });
  break;
}
```

And in `tool_execution_end`, look them up:

```ts
case "tool_execution_end": {
  if (!trace?.current_turn) break;
  const pending = trace.current_turn.pending_tool_calls.get(event.toolCallId);
  trace.current_turn.pending_tool_calls.delete(event.toolCallId);
  trace.current_turn.tool_calls_in_turn++;
  trace.totals.tool_calls++;

  const startedAt = pending?.started_at ?? now;
  const args = pending?.args ?? null;

  const resultJson = JSON.stringify(event.result ?? {});
  logger.log({
    ...baseEvent,
    event_type: "tool_call",
    data: {
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      args,
      result_preview: resultJson.slice(0, 500),
      result_size_bytes: resultJson.length,
      duration_ms: now - startedAt,
      is_error: event.isError,
    },
  });
  break;
}
```

The `?? null` fallback handles the edge case where `tool_execution_end` fires without a matching `tool_execution_start` (shouldn't happen in practice, but defensive code is free).

**Why this pattern shows up everywhere**

This is actually a very common shape in event-driven systems and worth internalizing. Events are designed to carry the *minimum* data needed to identify them — pi could have stuffed args into every tool event, but that's redundant data on the wire. Instead, events have correlation IDs (`toolCallId`), and consumers who need to join data across events keep their own state keyed by that ID.

You see the same pattern in:

- HTTP access logs that record request start with full headers, then correlate with response status by request ID
- OpenTelemetry spans, where you start a span with attributes and end it with a status (the span ID is the correlator)
- Message brokers where commands and acknowledgments share a correlation token
- Database query loggers that emit "query start" with the SQL and "query end" with row counts and timing

The architectural lesson: when you're consuming an event stream and find yourself wishing event B had data from event A, the answer is almost never "the library should add it." It's "you maintain a small piece of state keyed by the correlation ID." Your subscriber is the place where the join happens.

For OTel later (stage 8), this pattern transposes directly — `tool_execution_start` becomes `tracer.startSpan(...)` with args as attributes, you stash the span in a map keyed by `toolCallId`, and `tool_execution_end` retrieves it to attach the result and call `.end()`. Same shape, different mechanics.

One more thing worth knowing: there's also `tool_execution_update` for tools that stream partial results. If you ever want to capture mid-tool progress (rare but useful for long-running tools), it has `toolCallId`, `toolName`, `args`, and `partialResult` — but `args` is duplicated there too because update events stand alone. Pi's choice to omit args from `_end` is a deliberate "you should already know them by now" signal.

Good instinct cross-referencing the source. Reading the actual types is faster and more reliable than trusting any documentation, including mine.

## User

stage 4

## Claude

Good — Stage 4 is short and satisfying. Persistence makes the bot's "memory" real instead of a per-process illusion. After this stage, killing and restarting the REPL won't lose your conversation.

## What we're building

The agent already keeps conversation state in `agent.state.messages` — an array of `AgentMessage` objects that grows as the conversation proceeds. Persistence is just: save that array to a file when it changes, load it when the agent starts up.

The mental model: the agent is the runtime, the message array is the document. We're treating conversations like text files that get auto-saved.

## Design decisions worth thinking through

A few choices to make explicit before writing code:

**One file per user, not one file per conversation.** A user has *a* conversation that grows over time, not multiple discrete conversations. When stage 5 brings Discord, each Discord user gets their own file. The REPL is one user (`local`), so one file. Simple.

**JSON, not JSONL.** The whole message array is one document — you load it all or save it all. JSON is the right format. Different concern from the event log, which is append-only and naturally JSONL.

**Save on every turn, not on shutdown.** Tempting to save on `agent_end` only, but if the process crashes mid-run you lose data. The cost of saving on every meaningful state change is tiny. We'll save when `agent_end` fires (the cheapest moment that captures all the new state).

**Don't try to be clever about partial saves.** Some persistence layers do incremental updates — only write what changed. For our scale (kilobytes of messages, not megabytes), just rewrite the whole file. Code is simpler, behavior is obvious, performance is fine.

**Graceful loading: if the file doesn't exist or is corrupt, start fresh.** Don't crash the REPL because someone deleted a file. Log a warning, start with empty messages, move on.

## File structure

```
src/
├── observability/
├── persistence/
│   └── conversations.ts      # ConversationStore class
├── agent.ts                   # updated to wire in load+save
├── config.ts
├── repl.ts
└── tools.ts

data/
├── events.jsonl              # from stage 3
└── conversations/
    └── local.json            # user's conversation history
```

## `src/persistence/conversations.ts`

```ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export class ConversationStore {
  constructor(private rootDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  private pathFor(userId: string): string {
    // Sanitize: only allow safe filename characters. Discord IDs are numeric,
    // but defensive coding is free and prevents path traversal if userId ever
    // comes from somewhere less trusted.
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.rootDir, `${safe}.json`);
  }

  async load(userId: string): Promise<AgentMessage[]> {
    const path = this.pathFor(userId);
    const file = Bun.file(path);

    if (!(await file.exists())) {
      return [];
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        console.warn(`[persistence] ${path} is not an array, ignoring`);
        return [];
      }
      return parsed as AgentMessage[];
    } catch (err: any) {
      console.warn(`[persistence] failed to load ${path}: ${err.message}`);
      return [];
    }
  }

  async save(userId: string, messages: AgentMessage[]): Promise<void> {
    const path = this.pathFor(userId);
    const tmpPath = `${path}.tmp`;

    // Atomic write: write to temp file, then rename. Prevents corruption if
    // we crash mid-write — the original file remains intact, the tmp file
    // gets cleaned up on the next save.
    const json = JSON.stringify(messages, null, 2);
    await Bun.write(tmpPath, json);
    await Bun.$`mv ${tmpPath} ${path}`.quiet();
  }

  async clear(userId: string): Promise<void> {
    const path = this.pathFor(userId);
    const file = Bun.file(path);
    if (await file.exists()) {
      await Bun.$`rm ${path}`.quiet();
    }
  }
}
```

Three things worth calling out about this:

The atomic-write pattern (write to `.tmp`, then rename) matters more than it sounds. A naive `Bun.write(path, json)` can leave a half-written file if the process is killed during the write. Atomic rename on POSIX filesystems is guaranteed to be all-or-nothing, so the file you read on next startup is either the previous version or the new one — never garbage. This is a small habit that saves real pain.

Sanitizing the filename is paranoia that costs nothing. If someone ever passes a userId like `../../etc/passwd` (unlikely from Discord, but you'll have other frontends eventually), the regex prevents path traversal. Always sanitize untrusted input before it touches the filesystem.

I'm using `Bun.$` for `mv` and `rm` because Bun's shell API is genuinely nicer than `node:fs` for these one-shot file operations. Could also use `fs.rename` and `fs.unlink` from `node:fs/promises` — either is fine.

## Wire it into the agent factory

**`src/agent.ts`**

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { loadConfig } from "./config.js";
import { getTools } from "./tools.js";
import { AgentLogger } from "./observability/logger.js";
import { attachLogger } from "./observability/agent-subscriber.js";
import { ConversationStore } from "./persistence/conversations.js";

export interface AgentBundle {
  agent: Agent;
  logger: AgentLogger;
  store: ConversationStore;
  userId: string;
  setContext: (ctx: { trace_id: string; user_id: string }) => void;
  newTraceId: () => string;
}

export async function createAgent(userId = "local"): Promise<AgentBundle> {
  const config = loadConfig();

  // Logger setup (from stage 3)
  const logger = new AgentLogger("./data/events.jsonl");
  await logger.init();

  // Persistence setup (new)
  const store = new ConversationStore("./data/conversations");
  await store.init();
  const initialMessages = await store.load(userId);

  if (initialMessages.length > 0) {
    console.log(
      `[persistence] loaded ${initialMessages.length} messages for user "${userId}"`,
    );
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: getTools(),
      thinkingLevel: "off",
      messages: initialMessages,
    },
    streamFn: streamSimple,
  });

  let currentContext = {
    trace_id: logger.newTraceId(),
    user_id: userId,
  };

  attachLogger(agent, logger, () => ({
    ...currentContext,
    model: `${process.env.MODEL_PROVIDER ?? "anthropic"}/${
      process.env.MODEL_ID ?? "claude-sonnet-4-5-20250929"
    }`,
  }));

  // Save messages whenever the agent finishes a run.
  agent.subscribe(async (event) => {
    if (event.type === "agent_end") {
      try {
        // event.messages contains the full message array as of agent_end.
        // Snapshot it (in case the agent mutates state right after) and persist.
        const snapshot = [...event.messages];
        await store.save(userId, snapshot);
      } catch (err: any) {
        // Don't let persistence failures crash the agent. Log and move on.
        logger.log({
          timestamp: new Date().toISOString(),
          trace_id: currentContext.trace_id,
          user_id: userId,
          event_type: "error",
          data: {
            where: "ConversationStore.save",
            message: err.message,
            stack: err.stack,
          },
        });
      }
    }
  });

  return {
    agent,
    logger,
    store,
    userId,
    setContext: (ctx) => {
      currentContext = ctx;
    },
    newTraceId: () => logger.newTraceId(),
  };
}
```

The persistence subscription is a *separate* subscription from the logger. They each do their own thing, in their own callback, with no awareness of each other. This is the same pattern point I made earlier — multiple consumers of the same event stream, each focused on its own concern. Adding persistence didn't require touching the logger code at all.

The save is `async` and we don't `await` it inside the subscribe callback (well, we do — pi-agent-core awaits subscribers in registration order, per the docs you read earlier). This means subsequent code in the agent won't proceed until the save finishes. For our scale that's fine and actually desirable — you don't want a follow-up `agent.prompt()` to start before persistence has settled.

## REPL update

The REPL itself barely changes — it's just adding a `/clear` command for convenience and showing a more useful startup banner.

**`src/repl.ts`**

```ts
import * as readline from "node:readline/promises";
import { createAgent } from "./agent.js";

async function main() {
  const bundle = await createAgent("local");
  const { agent, logger, store, userId } = bundle;

  const DEBUG = process.env.DEBUG === "true";

  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }

    if (DEBUG) {
      if (event.type === "tool_execution_start") {
        process.stdout.write(
          `\n[tool] ${event.toolName}(${JSON.stringify(event.args)})\n`,
        );
      }
      if (event.type === "tool_execution_end") {
        const r = JSON.stringify(event.result ?? {}).slice(0, 300);
        process.stdout.write(`\n[result] ${r}\n`);
      }
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("homelab-agent REPL. Ctrl-C to quit.");
  console.log(`Logging to ./data/events.jsonl${DEBUG ? " (DEBUG mode)" : ""}`);
  console.log(`Conversation stored at ./data/conversations/${userId}.json`);
  console.log(`Loaded ${agent.state.messages.length} prior messages.`);
  console.log("\nCommands: /clear (wipe conversation), /info (stats)\n");

  const shutdown = async () => {
    process.stdout.write("\nshutting down...\n");
    await logger.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    const input = (await rl.question("\nyou> ")).trim();
    if (!input) continue;

    // Slash commands — handled before reaching the agent
    if (input === "/clear") {
      await store.clear(userId);
      agent.state.messages = [];
      console.log("[conversation cleared]");
      continue;
    }
    if (input === "/info") {
      console.log(`messages: ${agent.state.messages.length}`);
      console.log(`model: ${process.env.MODEL_ID ?? "claude-sonnet-4-5-20250929"}`);
      continue;
    }

    const trace_id = bundle.newTraceId();
    bundle.setContext({ trace_id, user_id: userId });
    logger.log({
      timestamp: new Date().toISOString(),
      trace_id,
      user_id: userId,
      event_type: "user_message",
      data: { content: input, content_length: input.length },
    });

    process.stdout.write("\nagent> ");
    try {
      await agent.prompt(input);
    } catch (err: any) {
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id,
        user_id: userId,
        event_type: "error",
        data: { where: "agent.prompt", message: err.message, stack: err.stack },
      });
      console.error(`\n[error] ${err.message}`);
    }
    process.stdout.write("\n");
  }
}

main();
```

The slash commands are a small but useful addition. You'll want `/clear` constantly while developing — it's tedious to manually delete the file every time you want a fresh conversation to test something. You'll also use it in stage 9 when running evals (each eval starts from an empty conversation).

## Try it

```bash
bun run repl
```

First run, you'll see "Loaded 0 prior messages." Have a multi-turn conversation:

```
you> how full is my main drive?
agent> [response]

you> and how about memory?
agent> [response]
```

Quit with Ctrl-C. Then look at the saved file:

```bash
cat data/conversations/local.json | jq 'length'
cat data/conversations/local.json | jq '.[].role'
```

Restart:

```bash
bun run repl
```

You should see "Loaded N prior messages." Now ask a follow-up that depends on the previous context:

```
you> what was the last thing I asked about?
```

It should answer correctly. The agent has no idea time passed — from its point of view, the conversation continued seamlessly.

Try `/clear`, ask the same question again. It should now have no idea what you asked about.

## Things to notice

You can now leave conversations open across restarts. This sounds trivial but it changes how you can use the bot. A homelab assistant that remembers "I had you check disk usage two days ago and it was at 78%" can now answer "is it getting worse?" — useful behavior that requires persistence.

The save happens *after* `agent_end`, not on every event. This is deliberate. Saving on every `message_update` would be hundreds of writes per turn for a streaming response. Saving on `agent_end` is once per user prompt. The trade-off is that a crash *during* an agent run loses that run, which is fine — you can retry it.

The conversation file grows monotonically. After 50 turns, it'll have 100+ messages (user + assistant + tool results all count). Stage 7 (context management) addresses what happens when this gets unwieldy — you'll see the file balloon and the input token count climb in your event log, which is the concrete observability that makes context management feel necessary instead of theoretical.

The atomic-write pattern (`.tmp` then rename) makes the save crash-safe but it's not crash-*free* — if Bun is killed between `agent_end` firing and the save completing, you lose the latest run. For your homelab bot, this is fine. For something with higher stakes, you'd write to a transactional log first and snapshot from there.

## Two things worth poking at

If you want to internalize the design:

Try crashing the bot mid-conversation. Ask a question, then `kill -9` the process while it's responding. Restart. See exactly what got persisted (probably the previous turn but not the current one). This is the failure mode of "save on agent_end" — useful to *see* it instead of just knowing it.

Look at the file with `jq` and notice the structure. Each message has a role, content, and pi-specific fields. There's tool calls, tool results, system messages, user messages. This is now the canonical representation of "what your agent knows" — when stage 7 implements context management, the operations happen on this exact structure.

## Homework worth doing

Add a `/messages` command that prints a summary of the conversation:

```ts
if (input === "/messages") {
  const counts = agent.state.messages.reduce(
    (acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  console.log("Message counts:", counts);
  console.log(`Total messages: ${agent.state.messages.length}`);
  // Estimate tokens: rough rule of thumb is 4 chars = 1 token
  const totalChars = JSON.stringify(agent.state.messages).length;
  console.log(`Approx tokens: ${Math.round(totalChars / 4)}`);
  continue;
}
```

This gives you a real-time view of how the conversation is growing. Run it after every few turns and watch the numbers. By the time you do stage 7, you'll have a strong intuition for "this is when context management starts mattering."

When you're ready, say "stage 5" and we'll wrap everything in Discord. Most of the work is already done — agent factory, logging, persistence — Discord becomes a thin frontend that gets all of it for free.

## User

can you convert this to use more bun appropriate code?

## Claude

Sure — Bun has cleaner APIs for most of what we're doing. Let me go through the project and Bun-ify it. The changes are mostly cosmetic but they're worth knowing because Bun's APIs are genuinely nicer once you internalize them.

## What's worth changing

A quick survey of node-isms in our code that have better Bun equivalents:

- `node:fs/promises` `mkdir`, `Bun.$ mv`, `Bun.$ rm` → `Bun.file()`, `Bun.write()`, with directory creation handled implicitly
- `node:crypto` `randomUUID()` → `Bun.randomUUIDv7()` (sortable UUIDs, useful for trace IDs that you'll want chronologically ordered)
- `node:readline/promises` → Bun's stdin streaming or `prompt()` (though readline is honestly fine)
- Manual `process.env` reads with defaults → `Bun.env` (same thing, more idiomatic in Bun code)
- `JSON.stringify` + `Bun.write` → just `Bun.write()` accepts objects directly... actually no, that's not true, scratch that
- `child_process.exec` + `promisify` → `Bun.$` shell

Let me rewrite the affected files.

## `src/observability/logger.ts`

The original used a `writer().flush()` pattern that's correct but heavier than needed. Bun's file writer with `append: true` is the cleaner shape:

```ts
import { randomUUIDv7 } from "bun";
import type { LogEvent } from "./types.js";

export class AgentLogger {
  private writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private path: string) {}

  async init(): Promise<void> {
    // Ensure parent directory exists. Bun.file().writer() won't create dirs.
    const dir = this.path.substring(0, this.path.lastIndexOf("/"));
    if (dir) {
      await Bun.$`mkdir -p ${dir}`.quiet();
    }
    this.writer = Bun.file(this.path).writer();
  }

  newTraceId(): string {
    // UUIDv7 is time-sortable — handy when you grep logs and want events
    // in chronological order without parsing timestamps.
    return randomUUIDv7();
  }

  log(event: LogEvent): void {
    if (!this.writer) {
      throw new Error("AgentLogger.init() must be called before log()");
    }
    const line = JSON.stringify(event) + "\n";
    this.writeQueue = this.writeQueue.then(async () => {
      this.writer!.write(line);
      await this.writer!.flush();
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.writer?.end();
  }
}
```

Two real changes here: `randomUUIDv7()` from Bun for sortable trace IDs (small but genuinely nicer for log analysis later — you can sort by trace ID and get chronological order without parsing the timestamp), and `Bun.$ mkdir -p` instead of importing `node:fs/promises`. The shell-out is fine; Bun's `$` is fast and the alternative (`fs.mkdir(..., { recursive: true })`) is one more import for one line.

## `src/persistence/conversations.ts`

This is where Bun's APIs shine — `Bun.file()` is genuinely simpler than `fs/promises`:

```ts
import { join } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

export class ConversationStore {
  constructor(private rootDir: string) {}

  async init(): Promise<void> {
    await Bun.$`mkdir -p ${this.rootDir}`.quiet();
  }

  private pathFor(userId: string): string {
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.rootDir, `${safe}.json`);
  }

  async load(userId: string): Promise<AgentMessage[]> {
    const path = this.pathFor(userId);
    const file = Bun.file(path);

    if (!(await file.exists())) {
      return [];
    }

    try {
      // Bun.file().json() parses JSON in one call.
      const parsed = await file.json();
      if (!Array.isArray(parsed)) {
        console.warn(`[persistence] ${path} is not an array, ignoring`);
        return [];
      }
      return parsed as AgentMessage[];
    } catch (err: any) {
      console.warn(`[persistence] failed to load ${path}: ${err.message}`);
      return [];
    }
  }

  async save(userId: string, messages: AgentMessage[]): Promise<void> {
    const path = this.pathFor(userId);
    const tmpPath = `${path}.tmp`;

    // Atomic write: write to temp, then rename.
    // Bun.write() accepts objects but stringifies without indentation.
    // We pass a string for pretty output (helpful when reading the file by hand).
    await Bun.write(tmpPath, JSON.stringify(messages, null, 2));
    await Bun.$`mv ${tmpPath} ${path}`.quiet();
  }

  async clear(userId: string): Promise<void> {
    const path = this.pathFor(userId);
    if (await Bun.file(path).exists()) {
      await Bun.$`rm ${path}`.quiet();
    }
  }
}
```

The wins here: `await file.json()` instead of `JSON.parse(await file.text())`. `Bun.file(path).exists()` instead of `fs.access` try/catch dance or `fs.stat`. The file class is genuinely the right abstraction for "a thing on disk" in a way `fs` never quite was.

I kept `node:path`'s `join` — Bun has no replacement for path manipulation, and reaching into `node:` modules for that is fine.

## `src/tools.ts`

Bun's shell (`Bun.$`) replaces `child_process.exec` + `promisify` and is meaningfully nicer because of how it handles command construction and output capture:

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

// Shared helper using Bun.$
async function runCommand(
  command: string,
  options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    // Bun.$ with .nothrow() returns the result instead of throwing on non-zero exit.
    // .quiet() suppresses passthrough to the parent process's stdout/stderr.
    const result = await Bun.$`sh -c ${command}`
      .nothrow()
      .quiet()
      .timeout(options.timeoutMs ?? 10_000);

    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  } catch (err: any) {
    // Timeout or unexpected errors (rare with .nothrow())
    return {
      stdout: "",
      stderr: err.message ?? String(err),
      exitCode: 1,
    };
  }
}

export const diskUsageTool: AgentTool = {
  name: "disk_usage",
  label: "Check disk usage",
  description:
    "Returns disk usage for mounted filesystems via `df -h`. " +
    "Use this whenever the user asks about disk space, free space, or storage capacity.",
  parameters: Type.Object({
    path: Type.Optional(
      Type.String({
        description: "Optional path to check. Defaults to all mounted filesystems.",
      }),
    ),
  }),
  execute: async ({ path }) => {
    return path ? runCommand(`df -h ${JSON.stringify(path)}`) : runCommand("df -h");
  },
};

export const memoryInfoTool: AgentTool = {
  name: "memory_info",
  label: "Check memory usage",
  description:
    "Returns RAM and swap usage via `free -h`. " +
    "Use this whenever the user asks about memory, RAM, or swap.",
  parameters: Type.Object({}),
  execute: async () => runCommand("free -h"),
};

export const systemUptimeTool: AgentTool = {
  name: "system_uptime",
  label: "Get system uptime",
  description:
    "Returns system uptime and load averages via `uptime`. " +
    "Use this when the user asks how long the system has been running or about CPU load.",
  parameters: Type.Object({}),
  execute: async () => runCommand("uptime"),
};

export const serviceStatusTool: AgentTool = {
  name: "service_status",
  label: "Check systemd service status",
  description:
    "Returns the status of a systemd service via `systemctl status`. " +
    "Use this to check if a specific service is running, stopped, or failed.",
  parameters: Type.Object({
    name: Type.String({
      description: "Service name (e.g., 'docker', 'nginx', 'sshd')",
      pattern: "^[a-zA-Z0-9._@-]+$",
    }),
  }),
  execute: async ({ name }) => {
    if (!/^[a-zA-Z0-9._@-]+$/.test(name)) {
      return {
        stdout: "",
        stderr: `Invalid service name: ${name}`,
        exitCode: 1,
      };
    }
    return runCommand(`systemctl status ${name} --no-pager`);
  },
};

export const dockerPsTool: AgentTool = {
  name: "docker_ps",
  label: "List running Docker containers",
  description:
    "Lists running Docker containers via `docker ps`. " +
    "Returns container ID, image, status, ports, and name for each.",
  parameters: Type.Object({
    all: Type.Optional(
      Type.Boolean({
        description: "If true, show stopped containers too. Defaults to running only.",
      }),
    ),
  }),
  execute: async ({ all }) => {
    return runCommand(all ? "docker ps -a" : "docker ps");
  },
};

export const runShellTool: AgentTool = {
  name: "run_shell",
  label: "Run shell command (debug only)",
  description:
    "Run an arbitrary read-only shell command. Only use when no narrower tool fits. " +
    "Refuse anything destructive.",
  parameters: Type.Object({
    command: Type.String({ description: "Command to run" }),
  }),
  execute: async ({ command }) => runCommand(command, { timeoutMs: 15_000 }),
};

export function getTools(): AgentTool[] {
  const tools: AgentTool[] = [
    diskUsageTool,
    memoryInfoTool,
    systemUptimeTool,
    serviceStatusTool,
    dockerPsTool,
  ];

  if (Bun.env.ENABLE_SHELL_TOOL === "true") {
    tools.push(runShellTool);
  }

  return tools;
}
```

The Bun.$ usage worth understanding:

`.nothrow()` flips the default behavior — normally Bun.$ throws on non-zero exit codes (like `set -e`). For tools that wrap diagnostic commands, we *want* the non-zero output (e.g., `systemctl status` returns 3 for inactive services, but we want to show that to the model). `.nothrow()` returns the `ShellOutput` object instead.

`.quiet()` prevents the command's output from being piped to the parent process's stdout/stderr. Without it, every tool call would leak its output to your terminal.

`.timeout(ms)` is built-in. No more racing against `setTimeout` or wrestling with `AbortController`.

I switched to `Bun.env.ENABLE_SHELL_TOOL` instead of `process.env.ENABLE_SHELL_TOOL`. Both work — Bun's `Bun.env` is just an alias for `process.env` with slightly better type inference in TS.

One subtle thing: `Bun.$\`sh -c ${command}\`` — using `sh -c` is necessary here because we want shell features (pipes, redirects if a tool ever wants them, argument splitting). Without `sh -c`, Bun.$ treats the whole `${command}` as a single argv entry and tries to exec it directly, which doesn't work for command strings like `"docker ps -a"`. The shell wrapper costs nothing.

## `src/config.ts`

Minor — switch to `Bun.env`:

```ts
import { getModel } from "@mariozechner/pi-ai";

export interface AppConfig {
  model: ReturnType<typeof getModel>;
  systemPrompt: string;
}

export function loadConfig(): AppConfig {
  const provider = Bun.env.MODEL_PROVIDER ?? "anthropic";
  const modelId = Bun.env.MODEL_ID ?? "claude-sonnet-4-5-20250929";

  if (provider === "anthropic" && !Bun.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (provider === "openai" && !Bun.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  return {
    model: getModel(provider, modelId),
    systemPrompt: [
      "You are a homelab assistant with read-only access to the local system.",
      "",
      "You have specific tools for common diagnostics:",
      "- disk_usage: check disk space",
      "- memory_info: check RAM and swap",
      "- system_uptime: check uptime and load",
      "- service_status: check a systemd service",
      "- docker_ps: list Docker containers",
      "",
      "Prefer the narrow tools over generic shell commands. If no tool fits, " +
      "say so rather than guessing. Keep responses concise — these will be read " +
      "in a chat interface.",
    ].join("\n"),
  };
}
```

## `src/agent.ts`

Just `Bun.env`:

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { loadConfig } from "./config.js";
import { getTools } from "./tools.js";
import { AgentLogger } from "./observability/logger.js";
import { attachLogger } from "./observability/agent-subscriber.js";
import { ConversationStore } from "./persistence/conversations.js";

export interface AgentBundle {
  agent: Agent;
  logger: AgentLogger;
  store: ConversationStore;
  userId: string;
  setContext: (ctx: { trace_id: string; user_id: string }) => void;
  newTraceId: () => string;
}

export async function createAgent(userId = "local"): Promise<AgentBundle> {
  const config = loadConfig();

  const logger = new AgentLogger("./data/events.jsonl");
  await logger.init();

  const store = new ConversationStore("./data/conversations");
  await store.init();
  const initialMessages = await store.load(userId);

  if (initialMessages.length > 0) {
    console.log(
      `[persistence] loaded ${initialMessages.length} messages for user "${userId}"`,
    );
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: getTools(),
      thinkingLevel: "off",
      messages: initialMessages,
    },
    streamFn: streamSimple,
  });

  let currentContext = {
    trace_id: logger.newTraceId(),
    user_id: userId,
  };

  attachLogger(agent, logger, () => ({
    ...currentContext,
    model: `${Bun.env.MODEL_PROVIDER ?? "anthropic"}/${
      Bun.env.MODEL_ID ?? "claude-sonnet-4-5-20250929"
    }`,
  }));

  agent.subscribe(async (event) => {
    if (event.type === "agent_end") {
      try {
        const snapshot = [...event.messages];
        await store.save(userId, snapshot);
      } catch (err: any) {
        logger.log({
          timestamp: new Date().toISOString(),
          trace_id: currentContext.trace_id,
          user_id: userId,
          event_type: "error",
          data: {
            where: "ConversationStore.save",
            message: err.message,
            stack: err.stack,
          },
        });
      }
    }
  });

  return {
    agent,
    logger,
    store,
    userId,
    setContext: (ctx) => {
      currentContext = ctx;
    },
    newTraceId: () => logger.newTraceId(),
  };
}
```

## `src/repl.ts`

The REPL stays mostly node-flavored because `node:readline/promises` is genuinely the right tool here — Bun doesn't have a better stdin interaction story. But we can switch the env reads:

```ts
import * as readline from "node:readline/promises";
import { createAgent } from "./agent.js";

async function main() {
  const bundle = await createAgent("local");
  const { agent, logger, store, userId } = bundle;

  const DEBUG = Bun.env.DEBUG === "true";

  agent.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    }

    if (DEBUG) {
      if (event.type === "tool_execution_start") {
        process.stdout.write(
          `\n[tool] ${event.toolName}(${JSON.stringify(event.args)})\n`,
        );
      }
      if (event.type === "tool_execution_end") {
        const r = JSON.stringify(event.result ?? {}).slice(0, 300);
        process.stdout.write(`\n[result] ${r}\n`);
      }
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("homelab-agent REPL. Ctrl-C to quit.");
  console.log(`Logging to ./data/events.jsonl${DEBUG ? " (DEBUG mode)" : ""}`);
  console.log(`Conversation stored at ./data/conversations/${userId}.json`);
  console.log(`Loaded ${agent.state.messages.length} prior messages.`);
  console.log("\nCommands: /clear (wipe conversation), /info (stats)\n");

  const shutdown = async () => {
    process.stdout.write("\nshutting down...\n");
    await logger.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (true) {
    const input = (await rl.question("\nyou> ")).trim();
    if (!input) continue;

    if (input === "/clear") {
      await store.clear(userId);
      agent.state.messages = [];
      console.log("[conversation cleared]");
      continue;
    }
    if (input === "/info") {
      console.log(`messages: ${agent.state.messages.length}`);
      console.log(`model: ${Bun.env.MODEL_ID ?? "claude-sonnet-4-5-20250929"}`);
      continue;
    }

    const trace_id = bundle.newTraceId();
    bundle.setContext({ trace_id, user_id: userId });
    logger.log({
      timestamp: new Date().toISOString(),
      trace_id,
      user_id: userId,
      event_type: "user_message",
      data: { content: input, content_length: input.length },
    });

    process.stdout.write("\nagent> ");
    try {
      await agent.prompt(input);
    } catch (err: any) {
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id,
        user_id: userId,
        event_type: "error",
        data: { where: "agent.prompt", message: err.message, stack: err.stack },
      });
      console.error(`\n[error] ${err.message}`);
    }
    process.stdout.write("\n");
  }
}

main();
```

## What didn't change and why

A few places I considered Bun-ifying but decided against:

The agent subscriber (`agent-subscriber.ts`) doesn't touch the filesystem or environment — it's pure logic. No Bun APIs apply. Leave it alone.

`node:path` for `join`. Bun has no replacement and there's no reason to want one. Path manipulation is path manipulation.

`node:readline/promises` for the REPL. Bun has no first-party stdin abstraction better than this. There's a `console.log` / `prompt()` pattern in some Bun examples but `readline` is what people actually use for non-trivial REPLs.

`process.on('SIGINT')`. There's no Bun-specific signal handler API; `process.on` works fine.

## A subtle thing about Bun.$

Worth knowing for when you write more tools: `Bun.$` template literals do automatic escaping of interpolated values, which is normally a feature (prevents shell injection) but can bite you when you want shell expansion. Compare:

```ts
// This is what you usually want — `path` is treated as a single argument,
// even if it has spaces or special chars.
await Bun.$`df -h ${path}`;

// This is what you DON'T usually want — `path` becomes a literal string
// passed to `sh -c`, which then re-parses it. If `path` contains shell
// metacharacters, they'll be interpreted.
await Bun.$`sh -c ${`df -h ${path}`}`;  // dangerous
```

In `runCommand` above, I'm passing `command` as a single string to `sh -c` because the tools build commands as strings. That's fine because we control the command construction (the tools build them from validated inputs), but it's worth understanding the trade-off. A more Bun-native approach for narrow tools would be to skip `runCommand` entirely and use `Bun.$` directly per tool:

```ts
execute: async ({ path }) => {
  const cmd = path
    ? Bun.$`df -h ${path}`.nothrow().quiet()
    : Bun.$`df -h`.nothrow().quiet();
  const result = await cmd;
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
},
```

This is "more Bun-native" and gets automatic escaping per-argument. The trade-off is that each tool now duplicates the result-shaping. For five tools it's fine; for fifty you'd want the `runCommand` helper back. Pick what feels right for your project size.

## Try it

Same as before:

```bash
bun run repl
```

Behavior is identical. The win isn't visible at runtime — it's that the codebase now reads as Bun code instead of "Node code that happens to run in Bun." Smaller surface, more consistent style, fewer transitive node imports.

## What this taught beyond the rewrite

The actually-useful skill from this kind of refactor isn't "memorize Bun's API." It's developing taste for *which* runtime APIs are worth reaching for and *which* node-isms are fine to keep. Bun's pitch is "faster Node with nicer APIs," and that's largely true, but the speed comes from the runtime — using `Bun.file()` instead of `node:fs/promises` doesn't make your code faster, it just makes it idiomatic for the ecosystem you've chosen.

The places where Bun genuinely shines for our project:

`Bun.$` for shell — much better ergonomics than `child_process`.

`Bun.file()` for the "single file as a thing" abstraction — better than `fs/promises` for what we're doing.

`randomUUIDv7()` for time-sortable IDs — small but useful for log correlation.

The places it doesn't matter much: env vars, paths, signals, readline. Use what reads naturally.

This taste — when to use the platform's idioms, when to fall back to standards — is what makes you fluent in any ecosystem. Same lesson applies to picking AWS SDK calls vs. raw HTTP, or React-specific patterns vs. plain DOM. Knowing the platform's "happy paths" is most of the value.

When you're ready, say "stage 5" and we'll add Discord. Most of the heavy lifting is now done — Discord ends up being a thin shell over the bundle we've built.

## User

what stages are left?

## Claude

Here's where we are and what's left:

**Done**

- Stage 0: REPL with one shell tool
- Stage 1: Refactored into modules with env-driven model swap
- Stage 2: Narrow tools (you also added `read_log`)
- Stage 3: Structured JSONL logging with trace IDs
- Stage 4: Conversation persistence

**Remaining**

- **Stage 5: Discord wrapper** — same agent, second frontend. Per-user agents, per-user conversation files. Containerize and deploy to your homelab. Bot becomes "always on."

- **Stage 6: Failure handling** — loop detection in `beforeToolCall`, retry-with-backoff for provider errors, total tool-call cap per user message, better tool error messages so the model self-corrects.

- **Stage 7: Context management** — `transformContext` hook with sliding window plus tool-result trimming. You'll watch token counts in your logs stop growing unboundedly.

- **Stage 8: OpenTelemetry tracing** — OTel SDK, Jaeger locally, spans for each tool and turn using `gen_ai.*` semantic conventions, trace IDs connected back to your JSONL.

- **Stage 9: Evaluation framework** — eval runner, hand-written cases plus curated cases from your real logs, programmatic checks, LLM-as-judge for semantic checks. `bun run evals` becomes part of your dev loop.

- **Stage 10: Confirmation pattern** — read-only-by-default, `!unlock 5min` to enable destructive tools, `restart_service` or `restart_container` as the first destructive tool gated behind it.

- **Stage 11 (optional): Langfuse** — point your OTel exporter at Langfuse for LLM-specific dashboards (cost over time, tokens per conversation, prompt versioning if you want it).

**A note on order**

The order I gave originally is one valid path, but you can reshuffle if your interest pulls elsewhere. A few ways the dependencies actually work:

Stages 5, 6, 7 are fairly independent. You could do 6 and 7 before 5 if you'd rather harden the REPL first. Or skip straight to 5 if you want the Discord experience now and harden afterward.

Stage 8 (OTel) is independent of 5-7. You could do it next if observability is what you most want to learn — your existing JSONL setup is enough to layer OTel on top of.

Stage 9 (evals) is most useful *after* you have something worth evaluating that's seen some real traffic. Doing it too early means hand-writing all your eval cases without the benefit of real failures to curate from. I'd save it for after stage 5 minimum.

Stage 10 wants stages 6 and 7 first (you don't want destructive actions firing when context is unbounded or loops aren't detected), but is otherwise free-floating.

Stage 11 is purely optional dessert.

Where do you want to go next?

## User

what do you think about splitting 5 into 3 parts: discord, https://github.com/earendil-works/pi/blob/main/packages/tui and https://github.com/earendil-works/pi/blob/main/packages/web-ui?

## Claude

That's a really good instinct, and yes — splitting Stage 5 into three frontends is the right call for what you're trying to learn. Let me think through it with you, because there are some interesting design choices involved.

## Why this split is genuinely useful

Each frontend forces you to confront a different aspect of agent integration:

**Discord** is about asynchronous, multi-user, distributed-deployment concerns. Per-user agent instances, message length limits, typing indicators, deployment-as-a-service. It's the closest thing to "production agent infrastructure" you'll build.

**TUI** is about real-time, single-user, rich rendering. Streaming output that updates in place, interactive controls, keyboard shortcuts, theming. It's where you learn how good agent UX actually feels — tool calls rendered as collapsible blocks, progress shown live, context usage in a footer.

**Web UI** is about HTTP boundaries, browser concerns, and the agent-as-API pattern. Streaming over SSE or WebSocket, state management on the client, multi-session handling on the server. It's the closest to "I built an agent product" experience.

Building all three teaches you that the *agent* is the same in all cases — your `createAgent()` factory, your tools, your logging, your persistence — and the *frontend* is wildly different concerns. This is a core insight for agent work: agents are libraries, not applications. Each delivery surface is its own engineering problem.

## A real concern to flag first

I want to verify that those packages are what you think they are before we plan around them. The pi-mono README I read showed `@mariozechner/pi-tui` and `@mariozechner/pi-web-ui` as the official packages from `badlogic/pi-mono`. The `earendil-works/pi` repo you linked appears to be a different fork or related project — let me check.

Ah — important discovery. The pi project recently moved from `badlogic/pi-mono` (`@mariozechner/*` packages) to `earendil-works/pi` (`@earendil-works/*` packages). This is the new canonical home. The packages are the same monorepo, just renamed to a new scope. Worth knowing for stage 5+ — when you set up Discord/TUI/Web UI, you might want to migrate your existing imports too. The migration is mechanical: `@mariozechner/pi-ai` → `@earendil-works/pi-ai`, same for the others.

OK, with that confirmed — yes, those are real, supported packages with first-party support. The split makes sense.

## How I'd actually structure the split

Here's my proposal:

**Stage 5a: Discord** (the original Stage 5)

Discord first because it's the most useful frontend for a homelab bot. You can mention `@bot` from your phone while away from your desk. Per-user agents force the multi-tenancy lesson. Containerization-and-deployment is the lesson layered on top. By the end of 5a, your bot is *actually running* somewhere persistent and you're using it.

This is the least visually fancy of the three but the most operationally meaningful. It exercises the agent factory, persistence, and logging in a way the REPL doesn't — multiple concurrent users, network interruptions, retries, deployment.

**Stage 5b: TUI**

Once you have something operationally real, the TUI is about taste. The REPL we have is the simplest possible terminal frontend — write text, get text back. A real TUI is a different animal: collapsible tool-call blocks, live-updating context-usage footer, in-place text streaming with markdown rendering, keyboard shortcuts for `/clear` and `/info` instead of typed slash commands, a status line showing the current model and total cost.

`@earendil-works/pi-tui` (formerly `@mariozechner/pi-tui`) is purpose-built for this — it's the same library that powers `pi-coding-agent`'s interface, with differential rendering for flicker-free updates and components for editors with autocomplete and markdown rendering. You'll learn the library by porting your REPL onto it. The lesson is in *what* a good agent UI looks like and how much of that is library work vs. glue work.

The trade-off worth noting: pi-tui is stylistically opinionated. You're learning *one* designer's view of how agent TUIs should look. That's fine and probably the right starting point — getting opinions on how something should feel is faster than having no reference.

**Stage 5c: Web UI**

The web frontend is where you confront the agent-as-API pattern most directly. The browser doesn't import your `Agent` — it talks to a Bun HTTP server that hosts the agent. This split is fundamental to most production agent deployments and worth feeling.

`@earendil-works/pi-web-ui` provides web components for AI chat interfaces, which gives you the rendering primitives (markdown, code blocks, tool call formatting). You build the server side: HTTP endpoints, streaming over SSE or WebSocket, session/auth, multi-user state.

This is also where you confront streaming-over-HTTP for real. Discord's API hides it; the TUI is in-process. The web UI forces you to translate `agent.subscribe()` events into a wire protocol your browser can consume turn by turn. That's a foundational skill.

The other thing the web frontend teaches: hosting. Now you have a Bun server with a domain (or an exposed port on Tailscale, or behind a reverse proxy). Authentication. CORS. TLS. These are real concerns the moment you have a browser-facing agent.

## Revised plan

```
Stage 5a: Discord wrapper                   ← deployment, multi-user
Stage 5b: TUI (pi-tui)                      ← interactive UX, in-process
Stage 5c: Web UI (pi-web-ui + Bun server)   ← API design, streaming HTTP
Stage 6: Failure handling
Stage 7: Context management
Stage 8: OpenTelemetry tracing
Stage 9: Evaluation framework
Stage 10: Confirmation pattern
Stage 11 (optional): Langfuse
```

## Things worth thinking about before committing

A few honest concerns that aren't blockers but are worth knowing:

**Three frontends triples the surface area for stages 6-10.** When you add failure handling in stage 6, you'll want to test it in all three places. When you add context management in 7, all three frontends benefit but you need to verify each. This is fine — it's actually realistic of how multi-frontend products work — but it'll slow your absolute pace. The trade is that you'll have *deeply internalized* the agent-vs-frontend separation, which is the lesson.

**The frontends don't have equal value-density for learning.** Discord and Web UI both teach you something fundamentally different (multi-user-async, browser-server-streaming). The TUI is more about taste and library familiarity than core architectural lessons. If you're optimizing strictly for "what transfers to work," you could plausibly skip the TUI and lose the least. But if you're optimizing for "I want to enjoy using my homelab bot daily," the TUI is genuinely the most pleasant interface to live with.

**Pi-web-ui is a web-components library, not a framework.** It gives you rendering primitives but you'll still write the host page and the server. That's actually good for learning — the seams are visible. But know going in that you're not getting a one-line "spin up a web app" experience.

**Both pi-tui and pi-web-ui assume in-process or local agent.** Discord assumes the opposite. This is the right architecture but it does mean 5a and 5c are structurally different — Discord could theoretically share a backend with the web UI, or they could be separate. That's a design choice you'll get to make.

## My recommendation

Do all three, in the order above. Each one teaches something distinct enough to be worth the time. Don't try to merge any of them.

Two specific suggestions for how to scope each:

For **5a Discord**, keep it minimal: per-user agents in a Map, mention-based activation, message splitting for the 2000-char limit, containerized deploy. Don't try to add Discord-specific features (embeds, buttons, slash commands) until later. The point is the always-on deployment, not Discord-richness.

For **5b TUI**, port the REPL to pi-tui directly — same agent, same tools, same persistence, same logging. Just better rendering. The first version should be "the REPL but with markdown and collapsible tool calls." Don't reach for advanced pi-tui features until you've felt the basic ones.

For **5c Web UI**, separate the server (Bun HTTP, hosts the agent, exposes streaming endpoint) from the page (HTML + pi-web-ui components). Even if you serve them both from the same Bun instance, keep the architectural separation visible. This is what makes the lesson transferable to "now I want to deploy this agent as an SaaS."

One more thing: when you do the migration to `@earendil-works/*`, do it as a small refactor between stages 4 and 5a. Just `bun remove @mariozechner/pi-ai @mariozechner/pi-agent-core && bun add @earendil-works/pi-ai @earendil-works/pi-agent-core`, then a find-and-replace on imports. Tiny stage but worth doing while you have only one frontend to update — once you have three, the migration would be three times more annoying.

Want to start with the migration plus 5a, or jump straight into one of the frontends?

## User

before we go further, youre right, i wasnt thinking about all of that. to be honest, i told my manager at work about me learning to build a custom agent and he told me to think about creating a 2hr workshop to help others in my company go through and learn essentially what im learning now. he also brought up the tui and web uis since discord wouldnt be a part of that workshop. maybe what we do is just the discord piece (that was my initial goal anyway) and tack on the workshop + other ui flavors afterwards.

## Claude

That's a meaningful shift in scope, and yeah — splitting it that way is the right call. Two different audiences with two different needs.

**Your homelab bot** wants to be useful to *you*. Discord is the right interface because it's already on your phone, it survives restarts, and you can ping it from anywhere. The TUI and Web UI would be nice-to-haves you'd rarely use.

**The workshop** wants to be useful to a room of engineers in 2 hours. That's a fundamentally different design problem, and it's worth taking seriously as its own thing — not as a side-quest tacked onto homelab work.

A few things worth saying before you go further down either path:

**The workshop is going to make you a better engineer than the homelab bot will.** Teaching forces you to articulate what you actually understand vs. what you can just do. The first time you try to explain `transformContext` to a room of people who've never seen pi-agent-core, you'll discover gaps in your own model that going through stages 6-10 alone wouldn't surface. This is genuinely high-value for you, not just for them. Don't undersell it as "the side project."

**A 2-hour workshop is shockingly little time.** For real, scope-wise. If your audience is mixed — some senior engineers, some junior, some who've never touched an LLM API — you'll spend the first 20 minutes on setup. Then 90 minutes of actual content is maybe four discrete concepts, with hands-on time. That's not enough for stages 1-10; that's enough for *one good arc* that makes them feel "oh, I get it now."

**Treat the workshop as a teaching artifact, not a documentation dump.** The mistake people make with technical workshops is trying to cover everything. The thing that lands is one strong narrative: a clear before/after, one moment where their mental model clicks, one piece of code they can take home. Stages 1-10 of your homelab journey aren't a workshop — they're a curriculum. The workshop is the curated highlights reel.

**You don't have to teach everything you know.** It's tempting to want to show off the observability stack, evals, OTel — all the cool stuff. Resist this. Pick the 2-3 ideas that *most non-LLM engineers don't have* and teach those well. My guess: (1) "an agent is just a loop, here's the loop," (2) "tools are just functions with descriptions," (3) "you need to see what's happening or you're flying blind." That's a complete arc.

**Concrete plan I'd suggest:**

Finish your homelab bot through Stage 5a (Discord) plus enough of stages 6 and 7 to make it actually robust as a daily-driver. Stop. Then *separately* design the workshop, treating it as its own scoping problem with its own audience analysis. Don't try to make the workshop be "here's my homelab journey, condensed" — that won't translate. Design it from "what does someone walk away knowing in 2 hours" backward.

The TUI and Web UI flavors can be live demos in the workshop ("here's what the same agent looks like in three different frontends, notice how the agent code didn't change") rather than something you build from scratch with the participants. That's a much better use of demo time than walking through pi-tui's API.

Want to keep going on the homelab/Discord track for now, and revisit workshop design separately when you're ready? Or would it help to spend a turn thinking through workshop scope first so you have a clearer destination?

## User

2 things: youre right and my manager suggested the workshop be about "demystifying the agent", so showing them and working with them about "its just a loop" (what originally clicked for me) would be the right call. for the discord portion, the agent will need to be publicly available right?

## Claude

Both good points to dig into — let me take them in order.

**On the workshop framing**

"Demystifying the agent" is a great title and your manager has good instincts. That framing is exactly right because the people in the room have probably *used* an agent (Claude Code, Cursor, ChatGPT with tools) but never *built* one, and the gap between those two states feels much bigger than it actually is. The workshop's job is to compress that gap.

The structure that almost writes itself from "demystifying" plus "it's just a loop":

Start with a live demo of an agent doing something tool-using — call disk_usage, summarize, done. Then show the LLM API call that happens *underneath* — same prompt, no agent, model just produces text. The contrast is the hook. "How did the first one know to actually run df? Let's build it from scratch in 90 minutes."

From there, you build up: a single `complete()` call → add a tool definition and detect when the model wants to call it → run the tool → feed the result back → loop until no more tool calls. That's the entire mystery, and it lands in about an hour if you pace it well. The remaining time is "here's why observability matters" with a quick log/trace demo, and "here's what production hardening looks like" as a roadmap they can explore later.

You'd be teaching them the same thing that clicked for you ("oh, it's just a loop"), in roughly the same order you discovered it. That's good pedagogy — your own learning trajectory is a reasonable proxy for what an unfamiliar engineer needs.

I'll leave workshop design alone for now since you flagged we'd come back to it. Worth letting it marinate. Sometimes the right structure shows up when you're not actively thinking about it.

**On Discord and public availability — this is a great question and the answer is "no, actually"**

There's a really common misconception about how Discord bots work that's worth clearing up because it changes your deployment options dramatically.

A Discord bot does *not* receive incoming HTTP requests. Your bot doesn't need a public IP, a domain, port forwarding, or a reverse proxy. Discord bots use an outbound persistent WebSocket connection — your bot connects *out* to Discord's gateway servers and stays connected. When a user sends a message your bot can see, Discord pushes that message down the existing connection. When your bot replies, it does so via outbound HTTPS calls to Discord's REST API.

This means: as long as your bot can reach the open internet for outbound traffic, it works. Behind a NAT, no port forwarding, on residential ISP, on Tailscale-only — all fine. The bot phones home to Discord, not the other way around.

The practical implications for your homelab:

You can run the bot on any machine in your homelab with no special networking setup. No exposing ports, no Cloudflare tunnel, no dynamic DNS. Just `docker compose up` on whatever machine and it works. Discord doesn't know or care where the bot lives.

This is actually one of the reasons Discord bots are popular for homelab automation — they're a free way to get a chat interface that works from anywhere on your phone, with no public-facing infrastructure. You're effectively using Discord as a reverse proxy/auth layer that happens to be hosted by someone else.

The only public-facing-ish aspect is that anyone who can see your bot in Discord (i.e., is in a server it's invited to) can send it messages. That's a different concern than network exposure — it's authorization. You handle it the way I mentioned earlier: gate on `message.author.id` so only your Discord user can actually trigger commands. Everyone else who tries gets ignored.

The contrast worth understanding, since this *will* come up when you build the web UI in the workshop demos later:

A Discord bot is "outbound-connected client" — your code initiates the connection.

A web UI server is "inbound-listening server" — your code waits for browsers to connect.

The first works behind any firewall with internet access. The second needs to be reachable from the network you're serving. That asymmetry is why the web UI flavor has fundamentally different deployment concerns than the Discord one — for the homelab web UI specifically, you'd typically expose it only on Tailscale or behind a reverse proxy with auth, not on the public internet.

So for stage 5a Discord: any Linux box in your homelab that can reach `discord.com` works. No infra prep needed. Containerize, `docker compose up`, you're done.

Does that change how you want to think about it, or are you ready to go ahead with stage 5a?

## User

ive already migrating to the new packages, lets move on to stage 5. remember im using bun not node

## Claude

Good. Stage 5 is satisfying because most of the work is already done — the agent factory, persistence, logging, and tools all just work. Discord becomes a thin frontend on top.

## What we're building

A Discord bot that:

- Responds when @mentioned in a server, or to any DM
- Maintains a separate conversation per Discord user (their own message history file)
- Shows a typing indicator while the agent works
- Splits long responses to fit Discord's 2000-character message limit
- Restricts who can use it via an allowlist
- Runs in a container on your homelab

The agent factory we built already supports per-user conversations (it takes `userId`). We just need to call `createAgent(discordUserId)` once per user and stash the bundle.

## Discord setup (one-time)

If you haven't done this yet:

1. Go to <https://discord.com/developers/applications> and click **New Application**. Name it something like `homelab-agent`.

2. **Bot** in sidebar → **Reset Token** → copy the token. This is `DISCORD_TOKEN`.

3. Same Bot page → scroll down to **Privileged Gateway Intents** → enable **MESSAGE CONTENT INTENT**. Save changes. Without this, your bot can see messages exist but can't read their text.

4. **OAuth2 → URL Generator** → tick `bot` under scopes. Under bot permissions, tick `Send Messages`, `Read Message History`, `View Channels`. Copy the URL at the bottom, open it in a browser, invite the bot to a server you control.

5. Get your own Discord user ID: in Discord, enable Developer Mode (Settings → Advanced → Developer Mode), right-click your username, "Copy User ID." This is `DISCORD_OWNER_ID`.

Add to `.env`:

```
DISCORD_TOKEN=...
DISCORD_OWNER_ID=...
```

Install discord.js:

```bash
bun add discord.js
```

## File structure

We're adding two files. The agent factory and everything else stays untouched.

```
src/
├── agent.ts                  # unchanged
├── config.ts                 # unchanged
├── tools.ts                  # unchanged
├── repl.ts                   # unchanged (still works)
├── discord.ts                # NEW: the Discord bot entry point
├── frontends/
│   └── discord-bot.ts        # NEW: the actual bot logic
├── observability/
└── persistence/
```

Splitting the bot into `frontends/discord-bot.ts` and `discord.ts` is mostly so the entry point stays trivial. The pattern echoes how `repl.ts` is the entry and the work happens in the agent factory — separating "how it starts" from "what it does."

## `src/frontends/discord-bot.ts`

```ts
import {
  Client,
  GatewayIntentBits,
  Events,
  type Message,
  ChannelType,
} from "discord.js";
import { createAgent, type AgentBundle } from "../agent.js";

interface BotOptions {
  token: string;
  ownerId: string;
  allowedUserIds: Set<string>;
}

export async function startDiscordBot(options: BotOptions): Promise<void> {
  const { token, allowedUserIds } = options;

  // One agent bundle per Discord user. Created lazily on first message.
  const agents = new Map<string, AgentBundle>();

  async function getOrCreateAgent(userId: string): Promise<AgentBundle> {
    let bundle = agents.get(userId);
    if (bundle) return bundle;

    bundle = await createAgent(userId);

    // Add a per-user subscriber for buffering text deltas. We need this
    // separate from the logger because Discord doesn't stream — it sends
    // complete messages — so we accumulate and send at the end.
    agents.set(userId, bundle);
    return bundle;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord] logged in as ${c.user.tag}`);
    console.log(`[discord] allowed users: ${[...allowedUserIds].join(", ")}`);
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;

    // Only respond to mentions in guild channels, but to all DMs.
    const isDM = message.channel.type === ChannelType.DM;
    const isMentioned = message.mentions.has(client.user!);
    if (!isDM && !isMentioned) return;

    // Allowlist check — silently ignore anyone not approved.
    if (!allowedUserIds.has(message.author.id)) {
      console.log(
        `[discord] ignored message from unauthorized user ${message.author.id}`,
      );
      return;
    }

    // Strip the @mention from the message text
    const userText = message.content
      .replace(`<@${client.user!.id}>`, "")
      .replace(`<@!${client.user!.id}>`, "")
      .trim();
    if (!userText) return;

    // Slash-style commands handled before reaching the agent
    if (userText === "/clear") {
      const bundle = agents.get(message.author.id);
      if (bundle) {
        await bundle.store.clear(message.author.id);
        bundle.agent.state.messages = [];
      }
      await message.reply("conversation cleared");
      return;
    }
    if (userText === "/info") {
      const bundle = agents.get(message.author.id);
      const count = bundle?.agent.state.messages.length ?? 0;
      const model = Bun.env.MODEL_ID ?? "claude-sonnet-4-5-20250929";
      await message.reply(`messages: ${count}\nmodel: ${model}`);
      return;
    }

    // Get the user's agent and prepare to handle this message.
    const bundle = await getOrCreateAgent(message.author.id);
    const { agent, logger } = bundle;

    // Start a fresh trace for this user message.
    const trace_id = bundle.newTraceId();
    bundle.setContext({ trace_id, user_id: message.author.id });
    logger.log({
      timestamp: new Date().toISOString(),
      trace_id,
      user_id: message.author.id,
      event_type: "user_message",
      data: { content: userText, content_length: userText.length },
    });

    // Buffer the agent's response. Subscribe just for this turn, unsubscribe
    // when done — otherwise subscribers from previous turns would still fire.
    let responseBuffer = "";
    const unsubscribe = agent.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta" &&
        typeof event.assistantMessageEvent.delta === "string"
      ) {
        responseBuffer += event.assistantMessageEvent.delta;
      }
    });

    // Show typing indicator while the agent thinks. Discord's sendTyping
    // lasts ~10 seconds, so we re-fire every 8s.
    const typingInterval = setInterval(() => {
      if ("sendTyping" in message.channel) {
        message.channel.sendTyping().catch(() => {});
      }
    }, 8_000);
    if ("sendTyping" in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    try {
      await agent.prompt(userText);
    } catch (err: any) {
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id,
        user_id: message.author.id,
        event_type: "error",
        data: {
          where: "agent.prompt",
          message: err.message,
          stack: err.stack,
        },
      });
      responseBuffer = `error: ${err.message}`;
    } finally {
      unsubscribe();
      clearInterval(typingInterval);
    }

    // Send the response, splitting at Discord's 2000-char limit.
    const reply = responseBuffer.trim() || "(no response)";
    await sendChunked(message, reply);
  });

  await client.login(token);
}

// Discord caps individual messages at 2000 characters. We chunk on word
// boundaries when possible to avoid breaking words awkwardly mid-flight.
async function sendChunked(message: Message, text: string): Promise<void> {
  const MAX = 1900; // a little under 2000 for safety margin
  if (text.length <= MAX) {
    await message.reply(text);
    return;
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX) {
      chunks.push(remaining);
      break;
    }

    // Look for the last newline in the first MAX chars; fall back to
    // last space; fall back to hard cut.
    let cutAt = remaining.lastIndexOf("\n", MAX);
    if (cutAt < MAX / 2) cutAt = remaining.lastIndexOf(" ", MAX);
    if (cutAt < MAX / 2) cutAt = MAX;

    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }

  // Reply once, then send subsequent chunks as follow-ups in the same channel.
  await message.reply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    if ("send" in message.channel) {
      await message.channel.send(chunks[i]);
    }
  }
}
```

A few things worth understanding about this:

**Per-message subscription, not persistent.** I subscribe to text deltas at the start of handling a message and unsubscribe at the end. The alternative — subscribe once when creating the agent, accumulate forever — would mix deltas from different users across different turns and be a mess. Each turn gets its own clean subscription. The persistent subscriptions (logger, persistence) are set up by `createAgent()` and stay attached for the agent's lifetime; the per-turn ones are rendering-specific and properly scoped to the turn.

**The agents Map is lifecycle-tied to the bot process.** It lives in memory; if the bot restarts, the Map is empty and agents get recreated on first message. That's fine because conversation state is on disk via `ConversationStore` — recreating an agent loads its messages. The Map is just a cache to avoid loading from disk on every message.

**`message.channel` type narrowing.** Discord.js's channel types are a discriminated union and TypeScript will complain about `sendTyping` and `send` not existing on every channel type. The `if ("sendTyping" in message.channel)` checks are how you narrow. There's a more elegant way using channel type predicates from discord.js but the property check is clearer for a learning codebase.

**Allowlist failure mode is silent.** Unauthorized users get no response at all — not even a "you're not authorized" reply. This is intentional. A friendly error message tells curious people that the bot exists and is locked down, which invites attention. Silence makes the bot indistinguishable from a non-existent one. For a homelab bot in a private server, this is the right default.

**No special handling for the destructive case.** Stage 10 will add the unlock pattern. For now, all your tools are read-only, so anyone in the allowlist (which is just you) can call anything safely.

## `src/discord.ts`

The entry point. Tiny:

```ts
import { startDiscordBot } from "./frontends/discord-bot.js";

const token = Bun.env.DISCORD_TOKEN;
const ownerId = Bun.env.DISCORD_OWNER_ID;

if (!token) {
  console.error("DISCORD_TOKEN is not set");
  process.exit(1);
}
if (!ownerId) {
  console.error("DISCORD_OWNER_ID is not set");
  process.exit(1);
}

const allowedUserIds = new Set([
  ownerId,
  ...(Bun.env.DISCORD_ALLOWED_USERS?.split(",").map((s) => s.trim()) ?? []),
]);

await startDiscordBot({ token, ownerId, allowedUserIds });
```

`DISCORD_ALLOWED_USERS` is optional — comma-separated extra IDs if you want to share the bot with someone. The owner is always included.

## `package.json` script

```json
{
  "scripts": {
    "repl": "bun run src/repl.ts",
    "discord": "bun run src/discord.ts"
  }
}
```

## Try it

```bash
bun run discord
```

You should see `[discord] logged in as homelab-agent#XXXX`. In your Discord server, mention the bot:

```
@homelab-agent how full is my main drive?
```

Or DM it:

```
how full is my main drive?
```

Watch the typing indicator, get a response. Now check `data/conversations/` — you'll see a new file named with your Discord user ID (a long numeric string) alongside the `local.json` file from REPL usage. They're separate conversations. Same code, different identity, different memory.

Now look at `data/events.jsonl` — Discord-originated turns appear interleaved with your earlier REPL turns, distinguished by `user_id` and `trace_id`. Try a `jq` query that splits behavior by user:

```bash
cat data/events.jsonl | jq -r '
  select(.event_type=="agent_response")
  | "\(.user_id) \(.data.total_tool_calls) \(.data.total_duration_ms)ms"
'
```

You can now answer questions like "are my Discord turns slower than REPL ones" (probably yes — Discord adds network round trips), "do I use different tools depending on the frontend" (probably yes — you ask different questions on the phone vs. terminal).

## Containerizing

`Dockerfile`:

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# data/ is created at runtime; we mount it as a volume in compose.

CMD ["bun", "run", "src/discord.ts"]
```

`docker-compose.yml`:

```yaml
services:
  homelab-agent:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      # Persist conversations and event logs across container restarts
      - ./data:/app/data
      # If your tools need to inspect the host's docker, mount the socket.
      # Comment out if you don't want this — it gives the agent root-equivalent
      # access to the host.
      - /var/run/docker.sock:/var/run/docker.sock
      # If your tools want to read host system info via SSH, mount a key.
      # - ~/.ssh/homelab_key:/root/.ssh/id_rsa:ro
    # If your homelab services run on a docker network, join it so the agent
    # can resolve them by name. Adjust the network name to match yours.
    # networks:
    #   - homelab
# networks:
#   homelab:
#     external: true
```

The commented-out bits are choices for you to make based on what your tools need to do. The tools we have right now (df, free, uptime, systemctl, docker ps) all need access to the *host's* state, but inside a container they'd see the container's state instead — which is mostly empty and uninteresting.

The pragmatic options for "agent in container, queries host":

1. **Mount the docker socket** so `docker ps` actually sees the host's containers. Trade-off: this is effectively root on the host. Fine for a personal homelab, not for anything real.

2. **Run the bot natively on the host** instead of containerized. `bun run src/discord.ts` under a systemd unit. Trade-off: less isolation, more dependent on host's bun install. Also genuinely fine for a personal homelab.

3. **Refactor your tools to SSH to the host** from inside the container. Adds complexity but isolates the agent properly. Worth it if you're doing this as preparation for production work.

For learning purposes, option 1 or 2 is fine. The agent itself doesn't care which you pick.

Run it:

```bash
docker compose up -d
docker compose logs -f
```

You should see the bot connect, and your existing Discord setup just works against the containerized bot.

## Things to notice / poke at

This is the moment your homelab assistant becomes real. Worth spending some time using it before moving on.

Walk away from your computer, send the bot a message from your phone, see it reply. That's the whole point of stage 5a — you can now ask "how's the homelab doing" from anywhere. Note how different that feels from the REPL.

Send the bot two questions back-to-back without waiting. Notice how it handles them — it should process them sequentially within your single user agent. The `agents` Map ensures one user has one agent, which means messages get queued through that agent's promise chain. (If you want concurrent handling, you'd need to either spawn agents per-conversation or use pi-agent-core's `followUp` queue. Worth knowing exists, not worth implementing now.)

Try asking the bot a question, then immediately asking a contradictory follow-up. It should remember context — the persistence layer is doing real work here. Compare with: stop the container, restart it, ask a follow-up referencing the previous question. It still remembers, because conversation state is on disk.

Look at the event log after you've used both REPL and Discord:

```bash
cat data/events.jsonl | jq -r '.user_id' | sort | uniq -c
```

You'll see your two distinct identities (`local` and your Discord ID) with their separate conversation histories. The same agent code is serving both — that's the architectural payoff of all the prior stages.

## Two homework suggestions

Try inviting a non-allowlisted Discord user (a friend, an alt account) and have them ping the bot. Confirm the bot stays silent and `[discord] ignored message from...` shows up in logs. This is your first real auth test — feel what "the bot exists but pretends not to" looks like.

If you have other machines in your homelab, write a tiny `ssh_disk_usage(host)` tool that takes a hostname and SSHs to run df. Mount your SSH key into the container. Now your bot can answer "how full is plex's drive" by SSHing to the right machine. This is the natural next tool, and it teaches you how the agent looks when it's coordinating across hosts rather than introspecting its own.

Whenever you're ready, say "stage 6" for failure handling. That's where the bot stops occasionally embarrassing itself when things go wrong.

## User

stage 6

## Claude

Good. Stage 6 is about making the bot stop embarrassing itself when things go wrong. The agent loop has a lot of failure modes you haven't felt yet because we've been driving on a clear road. We're going to install guardrails before something burns through tokens or gets stuck.

## What we're building

Five distinct protections, each addressing a specific failure mode:

1. **Loop detection** — abort if the agent calls the same tool too many times in one turn
2. **Tool call cap** — abort if total tool calls in a single user message exceed a threshold
3. **Tool error normalization** — make sure tool failures come back to the model as useful, structured errors, not crashes
4. **Provider retries** — survive transient API errors (rate limits, network blips) without dying
5. **Bot-level error reply** — when the agent fails entirely, the user gets a useful message, not silence

These layer cleanly. Each one solves a real problem and they don't interact much.

## Where each protection lives

This is worth understanding upfront because it shapes the code:

- Loop detection and tool call cap → `beforeToolCall` hook on the Agent
- Tool error normalization → inside each tool's `execute` (mostly already done) plus an `afterToolCall` hook for safety
- Provider retries → wrapper around `streamSimple` (the `streamFn` you pass to the Agent)
- Bot-level error reply → `try/catch` in the Discord handler we already have

Each protection is at the right architectural layer for the kind of failure it addresses. The agent core knows about tool calls; the streamFn knows about LLM provider errors; the bot knows about user-facing errors. Don't try to put everything in one place.

## File structure

We're adding two files and modifying two:

```
src/
├── safety/
│   ├── tool-guards.ts        # NEW: loop detection, call cap
│   └── retry.ts              # NEW: stream wrapper with retries
├── agent.ts                  # MODIFIED: wire in hooks and retry wrapper
├── tools.ts                  # MODIFIED: tighten error returns
└── frontends/
    └── discord-bot.ts        # MODIFIED: friendlier error replies
```

## `src/safety/tool-guards.ts`

This file holds the guards that hook into the agent loop:

```ts
import type { Agent } from "@earendil-works/pi-agent-core";

export interface ToolGuardOptions {
  /** Max times any single tool can be called within one user message. */
  maxCallsPerTool?: number;
  /** Max total tool calls within one user message. */
  maxTotalCalls?: number;
  /** Optional callback fired when a guard blocks a tool call. */
  onBlocked?: (info: { tool: string; reason: string }) => void;
}

interface CallStats {
  perTool: Map<string, number>;
  total: number;
}

export function attachToolGuards(
  agent: Agent,
  options: ToolGuardOptions = {},
): () => void {
  const maxCallsPerTool = options.maxCallsPerTool ?? 5;
  const maxTotalCalls = options.maxTotalCalls ?? 20;

  let stats: CallStats = { perTool: new Map(), total: 0 };

  // Reset counters at the start of each agent run (one user message).
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "agent_start") {
      stats = { perTool: new Map(), total: 0 };
    }
  });

  // The beforeToolCall hook is configured on the agent itself, not via subscribe.
  // We mutate the agent's options to attach our guard. This is the documented
  // shape for these hooks per pi-agent-core's API.
  const previousBefore = (agent as any).options?.beforeToolCall;

  (agent as any).options = {
    ...(agent as any).options,
    beforeToolCall: async (ctx: { toolCall: { name: string }; args: any }) => {
      // Run any prior beforeToolCall first
      if (previousBefore) {
        const result = await previousBefore(ctx);
        if (result?.block) return result;
      }

      const tool = ctx.toolCall.name;
      const perToolCount = stats.perTool.get(tool) ?? 0;

      if (stats.total >= maxTotalCalls) {
        const reason = `Too many tool calls in this turn (${stats.total}/${maxTotalCalls}). Stopping.`;
        options.onBlocked?.({ tool, reason });
        return { block: true, reason };
      }

      if (perToolCount >= maxCallsPerTool) {
        const reason = `Tool ${tool} called too many times (${perToolCount}/${maxCallsPerTool}). Try a different approach.`;
        options.onBlocked?.({ tool, reason });
        return { block: true, reason };
      }

      // Allow — increment counters
      stats.perTool.set(tool, perToolCount + 1);
      stats.total++;
      return undefined;
    },
  };

  return unsubscribe;
}
```

A few things worth understanding about this:

**The hook system.** Pi-agent-core's `beforeToolCall` hook (mentioned in the docs we read earlier) lets you intercept and optionally block tool calls. Returning `{ block: true, reason: "..." }` causes the agent to receive that reason as the tool result instead of executing. The model sees the reason and adapts — it'll try a different approach or admit it can't proceed. This is exactly the right primitive for guardrails.

**Counters reset on `agent_start`.** Each user message starts fresh. The reason: a five-minute conversation with twenty tool calls total is fine; twenty tool calls in *one turn* responding to *one question* is suspicious. The protection is per-question, not lifetime.

**The `(agent as any)` casts.** I'm not 100% sure of the exact API for setting hooks after construction — it may be that you need to pass `beforeToolCall` in the `Agent` constructor options instead of mutating after the fact. If pi-agent-core requires hooks at construction time, we'd move this into the agent factory directly. This is one of those "verify against actual library" things — I'll show you both ways and you can pick. Run it once and if `(agent as any).options =` doesn't take effect, switch to the constructor-time approach below.

**The `previousBefore` chaining.** If something else has already attached a `beforeToolCall` hook (it hasn't yet, but might in stage 10), we run it first and respect its block. Defensive composition — each guard plays nicely with others.

**Composable design.** `attachToolGuards` returns an unsubscribe function for the event listener. It doesn't return a way to undo the hook attachment, because hooks are typically lifetime-bound. If you needed to remove guards dynamically, you'd add that, but for our use you set them up once and they live for the agent's life.

If pi-agent-core needs hooks at construction time, the alternative is to pass them in `createAgent`:

```ts
// In agent.ts, in createAgent():
const guardState = { perTool: new Map<string, number>(), total: 0 };

const agent = new Agent({
  initialState: { /* ... */ },
  streamFn: streamSimple,
  beforeToolCall: async ({ toolCall }) => {
    // ... same logic, using closure over guardState
  },
});

// Reset guardState on agent_start via subscribe
agent.subscribe((event) => {
  if (event.type === "agent_start") {
    guardState.perTool.clear();
    guardState.total = 0;
  }
});
```

I'll show the integration both ways below — pick whichever works.

## `src/safety/retry.ts`

This wraps `streamSimple` with retry logic for transient provider errors:

```ts
import type { StreamFn } from "@earendil-works/pi-agent-core";

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    error: Error;
    delayMs: number;
  }) => void;
}

/**
 * Wrap a streamFn with retry-with-exponential-backoff for transient failures.
 *
 * Retries on: network errors, 429 (rate limit), 5xx, and explicitly
 * "overloaded" responses. Does NOT retry on 4xx auth errors or schema
 * errors — those won't get better by trying again.
 */
export function withRetry(streamFn: StreamFn, options: RetryOptions = {}): StreamFn {
  const maxAttempts = options.maxAttempts ?? 4;
  const initialDelayMs = options.initialDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  return async (model, context, opts) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await streamFn(model, context, opts);
      } catch (err: any) {
        lastError = err;
        if (!isRetryable(err) || attempt === maxAttempts) {
          throw err;
        }

        const delayMs = Math.min(
          initialDelayMs * 2 ** (attempt - 1),
          maxDelayMs,
        );
        // Add a little jitter to avoid synchronized retries if multiple
        // agents are hammering the same API at once.
        const jittered = delayMs + Math.random() * (delayMs * 0.25);

        options.onRetry?.({
          attempt,
          maxAttempts,
          error: err,
          delayMs: jittered,
        });

        await new Promise((r) => setTimeout(r, jittered));
      }
    }

    throw lastError ?? new Error("Retry loop exited unexpectedly");
  };
}

function isRetryable(err: any): boolean {
  // Network-level failures
  const code = err?.code ?? err?.cause?.code;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_SOCKET"
  ) {
    return true;
  }

  // HTTP status — try a few different shapes since providers vary
  const status = err?.status ?? err?.response?.status ?? err?.statusCode;
  if (typeof status === "number") {
    if (status === 429) return true; // rate limit
    if (status >= 500 && status < 600) return true; // server-side blips
  }

  // Anthropic and others sometimes send a structured "overloaded" error
  const message = String(err?.message ?? "").toLowerCase();
  if (message.includes("overloaded") || message.includes("temporarily unavailable")) {
    return true;
  }

  return false;
}
```

Things worth understanding here:

**Exponential backoff with jitter.** Standard pattern for retries. Delay doubles each attempt (1s, 2s, 4s, 8s) capped at 30s, plus 0-25% random jitter so multiple retrying clients don't synchronize and hammer the API at the same moment. This prevents the "thundering herd" problem when an API recovers from an outage.

**Retryable vs. non-retryable errors.** This is the most important judgment in the file. Retrying a 401 (bad API key) just delays the inevitable — you'll fail four times and waste latency. Retrying a 500 might succeed on the next try. The classification: network errors, 429s, 5xx, and "overloaded" messages are retryable; everything else propagates immediately.

**The error shape variance.** Different libraries surface the same conceptual error in different shapes — `err.status`, `err.response.status`, `err.cause.code`, `err.statusCode`. The defensive shape-checking is uglier than it should be but reflects reality. When you encounter a real provider error, log it raw first to see its shape, then add specific handling if needed.

**Doesn't retry forever.** `maxAttempts: 4` means up to 4 total attempts (1 initial + 3 retries). Beyond that, you're masking a real outage. Better to fail loudly than to leave your user staring at a typing indicator for a minute.

## Wire it into the agent factory

**`src/agent.ts`** (showing only the changed parts; everything else stays):

```ts
import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";
import { loadConfig } from "./config.js";
import { getTools } from "./tools.js";
import { AgentLogger } from "./observability/logger.js";
import { attachLogger } from "./observability/agent-subscriber.js";
import { ConversationStore } from "./persistence/conversations.js";
import { attachToolGuards } from "./safety/tool-guards.js";
import { withRetry } from "./safety/retry.js";

export interface AgentBundle {
  agent: Agent;
  logger: AgentLogger;
  store: ConversationStore;
  userId: string;
  setContext: (ctx: { trace_id: string; user_id: string }) => void;
  newTraceId: () => string;
}

export async function createAgent(userId = "local"): Promise<AgentBundle> {
  const config = loadConfig();

  const logger = new AgentLogger("./data/events.jsonl");
  await logger.init();

  const store = new ConversationStore("./data/conversations");
  await store.init();
  const initialMessages = await store.load(userId);

  if (initialMessages.length > 0) {
    console.log(
      `[persistence] loaded ${initialMessages.length} messages for user "${userId}"`,
    );
  }

  // Wrap streamSimple with retry logic
  let currentContext = {
    trace_id: "",
    user_id: userId,
  };

  const retryingStreamFn = withRetry(streamSimple, {
    maxAttempts: 4,
    onRetry: ({ attempt, maxAttempts, error, delayMs }) => {
      console.warn(
        `[retry] LLM call attempt ${attempt}/${maxAttempts} failed: ${error.message}. retrying in ${Math.round(delayMs)}ms`,
      );
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id: currentContext.trace_id,
        user_id: userId,
        event_type: "error",
        data: {
          where: "llm.stream.retry",
          message: `attempt ${attempt}/${maxAttempts}: ${error.message}`,
        },
      });
    },
  });

  const agent = new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: getTools(),
      thinkingLevel: "off",
      messages: initialMessages,
    },
    streamFn: retryingStreamFn,
  });

  currentContext = {
    trace_id: logger.newTraceId(),
    user_id: userId,
  };

  // Attach guardrails
  attachToolGuards(agent, {
    maxCallsPerTool: 5,
    maxTotalCalls: 20,
    onBlocked: ({ tool, reason }) => {
      console.warn(`[guard] blocked: ${reason}`);
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id: currentContext.trace_id,
        user_id: userId,
        event_type: "error",
        data: {
          where: "tool_guard",
          message: reason,
        },
      });
    },
  });

  attachLogger(agent, logger, () => ({
    ...currentContext,
    model: `${Bun.env.MODEL_PROVIDER ?? "anthropic"}/${
      Bun.env.MODEL_ID ?? "claude-sonnet-4-5-20250929"
    }`,
  }));

  // Persistence subscription (from stage 4)
  agent.subscribe(async (event) => {
    if (event.type === "agent_end") {
      try {
        const snapshot = [...event.messages];
        await store.save(userId, snapshot);
      } catch (err: any) {
        logger.log({
          timestamp: new Date().toISOString(),
          trace_id: currentContext.trace_id,
          user_id: userId,
          event_type: "error",
          data: {
            where: "ConversationStore.save",
            message: err.message,
            stack: err.stack,
          },
        });
      }
    }
  });

  return {
    agent,
    logger,
    store,
    userId,
    setContext: (ctx) => {
      currentContext = ctx;
    },
    newTraceId: () => logger.newTraceId(),
  };
}
```

The new pieces: import the safety modules, wrap `streamSimple` with retry before passing it to the Agent, and call `attachToolGuards` after construction.

A subtle thing: `currentContext` is initialized empty before `withRetry` sees it via closure, then mutated to the real value. This works because the closure captures the *reference* to `currentContext`, and we update it before the first LLM call happens. Slightly tricky pattern; if you find it confusing, you can extract a `getContext()` getter and pass it around explicitly.

## Tighten the tools

**`src/tools.ts`** — I want the `runCommand` helper to also enforce a result size cap. Tools that return enormous output (like `read_log`) burn tokens and can crash the agent's context window. Truncating at the tool level is the right place for it:

```ts
async function runCommand(
  command: string,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; truncated?: boolean }> {
  const maxOutputBytes = options.maxOutputBytes ?? 50_000;

  try {
    const result = await Bun.$`sh -c ${command}`
      .nothrow()
      .quiet()
      .timeout(options.timeoutMs ?? 10_000);

    let stdout = result.stdout.toString();
    let stderr = result.stderr.toString();
    let truncated = false;

    if (stdout.length > maxOutputBytes) {
      stdout = stdout.slice(0, maxOutputBytes) + "\n... [truncated]";
      truncated = true;
    }
    if (stderr.length > maxOutputBytes) {
      stderr = stderr.slice(0, maxOutputBytes) + "\n... [truncated]";
      truncated = true;
    }

    return { stdout, stderr, exitCode: result.exitCode, ...(truncated && { truncated }) };
  } catch (err: any) {
    return {
      stdout: "",
      stderr: err.message ?? String(err),
      exitCode: 1,
    };
  }
}
```

The 50KB cap is generous for most diagnostic commands but stops a misbehaving `read_log(lines: 100000)` from blowing up. The model sees `truncated: true` in the result and knows to either be more specific or accept the partial answer.

## Friendlier Discord error replies

**`src/frontends/discord-bot.ts`** — replace the existing error handling block with this:

```ts
try {
  await agent.prompt(userText);
} catch (err: any) {
  logger.log({
    timestamp: new Date().toISOString(),
    trace_id,
    user_id: message.author.id,
    event_type: "error",
    data: {
      where: "agent.prompt",
      message: err.message,
      stack: err.stack,
    },
  });

  // Categorize the error for user-facing message
  const status = err?.status ?? err?.response?.status;
  if (status === 401 || status === 403) {
    responseBuffer = "(authentication failure — check the bot's API key)";
  } else if (status === 429) {
    responseBuffer = "(rate limited — try again in a minute)";
  } else if (typeof status === "number" && status >= 500) {
    responseBuffer = "(model provider is having issues — try again shortly)";
  } else {
    responseBuffer = `(error: ${err.message?.slice(0, 200) ?? "unknown"})`;
  }
} finally {
  unsubscribe();
  clearInterval(typingInterval);
}
```

The point: the user sees a *short, useful* message indicating what went wrong, not a stack trace and not silence. The full error is in the logs for you. This is the right division — the user gets what they need to act ("try again later"), you get what you need to debug (logs and stack trace).

## Try it

Run the REPL or Discord bot, exercise things, then deliberately break stuff to see the guardrails fire.

**Test loop detection:** Ask a question that's likely to confuse the model into repeating itself. Or temporarily increase verbosity in your system prompt to encourage many tool calls. You can also force it: change `maxCallsPerTool` to 2 and ask "check disk usage three times in a row" — you'll watch the third call get blocked and the model adapt.

**Test tool call cap:** Set `maxTotalCalls` to 3 temporarily and ask "give me a complete system summary including disk, memory, uptime, services docker and nginx, and recent logs." The agent will hit the cap and have to wrap up early. The user-facing response should be coherent — the model received the block reason and adapted.

**Test retries:** Hardest to test cleanly. The easiest fake: temporarily set an invalid API URL or break network connectivity, watch the retries log out, then restore. Real provider outages are rare but you'll see the logs work when they happen.

**Test tool errors:** Try `service_status nonexistent_service`. The tool returns exit code 4 with an error message; the agent receives it, the model says "that service doesn't exist or isn't installed." No crash.

**Test container output truncation:** With the new `maxOutputBytes`, `read_log` with high line counts now returns truncated output instead of OOMing. Try `read_log syslog 100000` and watch the truncation marker appear.

## Things worth noticing

The protections are layered. Loop detection runs at the agent level. Truncation runs at the tool level. Retries run at the LLM-call level. Error replies run at the Discord level. Each layer handles what it knows about. This is a recurring pattern — when a system has multiple failure modes, you don't put one big try/catch around everything; you put narrow handlers at the right boundaries.

The guardrails make the model *more* useful, not less. It's tempting to think "I'm preventing the model from doing what it wants — it'll be worse." Actually the opposite: a model that gets a clear "stop, this isn't working" signal is much more useful than one that loops indefinitely. Guardrails free the model from its own bad patterns.

Look at your event log after a run that hit a guardrail:

```bash
cat data/events.jsonl | jq 'select(.event_type=="error" and .data.where=="tool_guard")'
```

You can now answer "how often do my guardrails fire" and "what tools tend to loop" — both useful for tuning the system. If `disk_usage` is hitting the loop limit a lot, that means the model isn't finding what it needs there, which usually means the tool's output isn't structured well. Observability + guardrails together let you find these bugs.

The retry layer is invisible when it works. That's the goal — most of the time you'll never know it kicked in. The `[retry]` warnings will show up periodically and you can grep for them in logs to see how often providers are having issues.

## Two homework suggestions

Add a counter to the bot's `/info` command that shows how many tool guards have fired in the current session. Forces you to expose state that the guard module currently keeps internal — good practice for thinking about what to expose vs. encapsulate.

Look at your real event log and find the longest single user message turn (highest `total_tool_calls`). Was it useful, or was the model thrashing? This is the question you'll always want to answer with observability data — and it tells you whether to tune `maxTotalCalls` up or down for *your* workload, not based on a default.

When you're ready, say "stage 7" and we'll handle the other elephant in the room — the conversation history that grows unboundedly and will eventually blow your context window.

## User

stage 7

## Claude

Good. Stage 7 is one of the most architecturally interesting stages — and one that you only really *understand* once you've seen the problem manifest in your own logs. Let me start by anchoring it there.

## The problem you can already see

Run this on your event log:

```bash
cat data/events.jsonl | jq -r '
  select(.event_type=="agent_response")
  | "\(.timestamp) tokens=\(.data.total_input_tokens + .data.total_output_tokens) duration=\(.data.total_duration_ms)ms"
'
```

If you've used the bot for a while, you'll see input tokens climb steadily across turns. That growth is your conversation history accumulating — every turn re-sends the entire history to the model. By turn 30, you're paying for re-sending turns 1-29 every time. By turn 100, you might have a cache hit on most of it (Anthropic's prompt caching kicks in) but you're still bumping toward the context window limit.

The other thing to notice: somewhere around turn 20, models *qualitatively* start being worse at things in long conversations. The "lost in the middle" problem is real. Even though the context window technically fits, the model effectively can't see information buried mid-conversation.

So context management is solving two problems at once: cost (don't pay for re-sending history forever) and quality (don't drown the model in irrelevant past).

## What we're building

Two strategies layered together:

1. **Tool-result trimming** — replace old tool outputs with a one-line placeholder. Tool results are usually the biggest tokens by far; trimming them aggressively is the cheapest big win.
2. **Sliding window** — keep only the most recent N turns of dialogue. Older turns get dropped entirely.

We'll use pi-agent-core's `transformContext` hook, which runs before each LLM call. It receives the full message array and returns a (potentially smaller) message array to actually send. The original `agent.state.messages` is preserved — the trimming is *only* for what gets sent to the LLM. This is important because you want to keep your full history on disk (for audit, for replay) but only send the model the slice it actually needs.

Worth re-reading the relevant bit from the pi-agent-core docs you found earlier:

> AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM
> (optional)                            (required)
> transformContext: Prune old messages, inject external context

That's the contract. The hook is where context management lives.

## Design choices to make explicit

A few things worth deciding before writing code:

**Token budget vs. message count.** You can decide what to trim by either "keep the last 20 messages" or "keep enough messages to stay under 30K tokens." Token budget is more correct (a single tool result might be 10K tokens, an exchange of pleasantries might be 50 tokens) but harder to estimate without running a tokenizer. We'll start with message count for simplicity, then refine to token-aware in the homework.

**What counts as "a turn."** A turn in pi-agent-core is one assistant message plus the tool calls/results it produced. So "keep the last 10 turns" might mean keeping 30+ messages (10 user + 10 assistant + tool results). The unit you keep is "the conversational round" not "the message."

**Don't trim the system prompt.** Obvious but worth saying — the system prompt is already separate (it's part of `Agent` initial state, not in `messages`). Whatever we do, we're operating on the messages array only.

**Don't drop messages without a trace.** When you skip messages, leave a tiny breadcrumb (`"... [12 earlier messages summarized]"`) so the model knows context was elided rather than thinking the conversation just started.

**Tool results trim *first*, then sliding window.** Tool results are giant, often stale, and usually only relevant for one or two turns. Trimming them is almost always a win. After that, if we still need to drop entries, we drop oldest user/assistant turns.

**Always keep the most recent N turns intact.** Even if old turns get summarized or dropped, the last few turns must always go through unmodified — those are what the user is actually following up on.

## File structure

```
src/
├── context/
│   └── transform.ts           # NEW: the transformContext hook
├── agent.ts                   # MODIFIED: wire it in
└── ...
```

## `src/context/transform.ts`

```ts
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface ContextTransformOptions {
  /**
   * Keep this many of the most recent turns intact (no tool-result trimming
   * for them, no dropping). A "turn" = a user message and the assistant
   * messages + tool results that come from it.
   */
  recentTurnsKeptIntact?: number;

  /**
   * Maximum number of total messages to send to the LLM. If the message array
   * after trimming is still longer than this, oldest non-protected messages
   * are dropped (with a breadcrumb).
   */
  maxMessages?: number;

  /**
   * Approximate max bytes per tool result before trimming. Tool results larger
   * than this in older messages get replaced with a placeholder.
   */
  toolResultMaxBytes?: number;

  /** Optional callback for observability — fires whenever this hook runs. */
  onTransform?: (info: {
    inputCount: number;
    outputCount: number;
    toolResultsTrimmed: number;
    messagesDropped: number;
  }) => void;
}

/**
 * Produce a transformContext function that:
 *   1. Replaces old, large tool results with a one-line placeholder.
 *   2. Drops oldest messages if the total count still exceeds maxMessages.
 *   3. Keeps the N most recent turns fully intact.
 *
 * Operates on a copy — the agent's state.messages is never mutated.
 */
export function makeContextTransform(
  options: ContextTransformOptions = {},
): (messages: AgentMessage[]) => Promise<AgentMessage[]> {
  const recentTurnsKeptIntact = options.recentTurnsKeptIntact ?? 3;
  const maxMessages = options.maxMessages ?? 60;
  const toolResultMaxBytes = options.toolResultMaxBytes ?? 1_000;

  return async (messages) => {
    const inputCount = messages.length;
    let toolResultsTrimmed = 0;
    let messagesDropped = 0;

    // Step 1: figure out which indices are "protected" (recent turns).
    // Walk backward from the end, counting turn boundaries (user messages),
    // until we've collected `recentTurnsKeptIntact` turns.
    const protectedIndex = findProtectedStartIndex(messages, recentTurnsKeptIntact);

    // Step 2: trim large tool results in non-protected (older) messages.
    let working = messages.map((msg, idx) => {
      if (idx >= protectedIndex) return msg;
      if ((msg as any).role !== "toolResult") return msg;

      const serialized = JSON.stringify((msg as any).content ?? "");
      if (serialized.length <= toolResultMaxBytes) return msg;

      toolResultsTrimmed++;
      // Replace the content with a short placeholder. Keep role/metadata so
      // pi-agent-core's downstream conversion still works.
      return {
        ...(msg as any),
        content: [
          {
            type: "text",
            text: `[tool result trimmed — was ${serialized.length} bytes]`,
          },
        ],
      } as AgentMessage;
    });

    // Step 3: if we're still over the message cap, drop oldest non-protected
    // entries and inject a breadcrumb at the front.
    if (working.length > maxMessages) {
      const protectedSlice = working.slice(protectedIndex);
      const headroom = maxMessages - protectedSlice.length;
      // Keep `headroom` newest messages from the older portion (still older
      // than the protected slice). If headroom <= 0, we drop everything older.
      const olderSlice = working.slice(0, protectedIndex);
      const keptOlder = headroom > 0 ? olderSlice.slice(-headroom) : [];
      messagesDropped = olderSlice.length - keptOlder.length;

      const breadcrumb: AgentMessage = {
        role: "user",
        content: [
          {
            type: "text",
            text: `[${messagesDropped} earlier messages omitted for brevity]`,
          },
        ],
      } as any;

      working =
        messagesDropped > 0
          ? [breadcrumb, ...keptOlder, ...protectedSlice]
          : [...keptOlder, ...protectedSlice];
    }

    options.onTransform?.({
      inputCount,
      outputCount: working.length,
      toolResultsTrimmed,
      messagesDropped,
    });

    return working;
  };
}

/**
 * Walk backward from the end of the messages array, finding the index where
 * we should start "protecting" (keeping intact). A turn starts at a user
 * message; we want the start of the Nth-most-recent user message.
 */
function findProtectedStartIndex(
  messages: AgentMessage[],
  turnsToKeep: number,
): number {
  if (turnsToKeep <= 0) return messages.length;

  let userMessagesSeen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as any).role === "user") {
      userMessagesSeen++;
      if (userMessagesSeen === turnsToKeep) return i;
    }
  }
  return 0; // fewer than N turns total — protect everything
}
```

A few important things to call out about this code:

**The `(msg as any).role` casting is uglier than it should be.** Pi-agent-core's `AgentMessage` is a discriminated union, and proper TypeScript narrowing would make this cleaner. I'm using `any` for brevity in the example. When you wire this up, do a `console.log(JSON.stringify(messages, null, 2))` once to see the actual shape, then tighten the types. The shape per the pi docs we found: `{ role: "user" | "assistant" | "toolResult", content: ContentBlock[] }` where content blocks have a `type` field.

**The breadcrumb is a fake user message.** Some libraries handle this with a synthetic system message; pi-agent-core's `AgentMessage` doesn't have a "system inserted" role per se, so the cleanest approach is to inject a brief user-role note. The model treats it as "the user said this" and reasons about it normally. Slightly hacky, totally functional.

**We never mutate the input.** `messages.map()` and `slice()` create copies. This is critical because pi-agent-core's `state.messages` is the canonical conversation; we're transforming it for *this LLM call*, not editing history. The next turn will receive the full untrimmed array again.

**Protection is by "user message boundaries."** The N-most-recent turns are protected by walking backward through the array, counting user messages as turn boundaries. Tool results from those recent turns are kept intact — we don't trim them because they might still be relevant context for the model's current reasoning.

**Trim before drop, drop before breadcrumb.** Order matters. If we dropped messages first and then trimmed tool results, we'd waste budget on tool results we'd already kept. Trimming first means more messages survive the size check.

## Wire it into the agent factory

**`src/agent.ts`** (showing the affected portion):

```ts
import { makeContextTransform } from "./context/transform.js";

// ... inside createAgent ...

const transformContext = makeContextTransform({
  recentTurnsKeptIntact: 3,
  maxMessages: 60,
  toolResultMaxBytes: 1_000,
  onTransform: (info) => {
    if (info.toolResultsTrimmed > 0 || info.messagesDropped > 0) {
      console.log(
        `[context] transform: ${info.inputCount} → ${info.outputCount} ` +
        `(trimmed ${info.toolResultsTrimmed} tool results, ` +
        `dropped ${info.messagesDropped} messages)`,
      );
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id: currentContext.trace_id,
        user_id: userId,
        event_type: "error", // reusing this event_type for now; see below
        data: {
          where: "context_transform",
          message: `${info.inputCount} → ${info.outputCount}, trimmed ${info.toolResultsTrimmed}, dropped ${info.messagesDropped}`,
        },
      });
    }
  },
});

const agent = new Agent({
  initialState: {
    systemPrompt: config.systemPrompt,
    model: config.model,
    tools: getTools(),
    thinkingLevel: "off",
    messages: initialMessages,
  },
  streamFn: retryingStreamFn,
  transformContext, // <-- new
});
```

A small wart: I reused `event_type: "error"` for the transform-fired log entry, which isn't quite right semantically. The cleaner thing is to add a `context_transform` event type to your `LogEvent` union from stage 3. Worth doing — extend the discriminated union with a new variant, give it a proper data shape, log to it from here. I'll leave that as an extension; the pattern's exactly the same as the other event types.

## Try it

Run the bot. Have a long conversation — at least 10-15 turns, ideally with a few tool calls per turn. Watch the `[context]` lines start to appear after enough history accumulates.

Then look at your token counts:

```bash
cat data/events.jsonl | jq -r '
  select(.event_type=="agent_response")
  | "\(.timestamp) input=\(.data.total_input_tokens) output=\(.data.total_output_tokens)"
'
```

You should see input tokens *plateau* rather than continuing to grow. The plateau is the visible effect of context management — past a certain conversation length, you're sending roughly the same amount each turn because old stuff gets trimmed.

For a stronger test: ask the bot to do something that touches lots of tools (`how is everything in the lab?`). Then have a 20-turn conversation about something else. Then ask `what was the very first thing I asked you about?` Watch what happens.

Two outcomes are possible:

1. The model says "I don't have full context for the start of our conversation" — your trimming is aggressive enough that the original turn was dropped. Working as designed.

2. The model recalls the first turn correctly — the breadcrumb told it that things were elided but the protected window happened to include the answer, or the model is confabulating. You'll learn which by checking the actual messages sent (log them in `onTransform` if you want to see).

Either outcome is informative. The trade-off is now visible: you've gained cost-bounded conversations and lost some long-tail recall. That's the right trade for a homelab bot. For an assistant where long-term recall matters more, you'd build summarization (described below).

## Things to notice

You can now have arbitrarily long conversations without input token count growing without bound. This is the actual win — it means you can leave a Discord conversation open for weeks and ping the bot occasionally without ever paying for the full history. Every turn costs roughly the same.

The trimmed tool results are *invisible to you in the UI* but visible to the model on disk. Pi-agent-core stores `state.messages` in full — your `data/conversations/<userId>.json` files still have the original tool outputs. The trim only happens at the LLM-input boundary. You can `cat` those files later to see the full history. This separation between "what's stored" and "what's sent" is a useful thing to internalize.

If you want to verify the trimming is working, add a debug print of the message array right before sending:

```ts
// inside makeContextTransform's returned function, just before return:
if (Bun.env.DEBUG_CONTEXT === "true") {
  console.log("[context] sending to LLM:", JSON.stringify(working, null, 2).slice(0, 2000));
}
```

Run with `DEBUG_CONTEXT=true bun run repl` and you'll see exactly what the model receives.

## What we didn't do (and what's next-level)

The strategies we've implemented are the cheap, high-impact ones. The next tier is **summarization** — when you trim old messages, instead of dropping them entirely, ask a small model to compress them into a short summary that gets prepended to context. Pi-coding-agent ships compaction logic that does exactly this, and you saw the events for it in our type research (`compaction_start`, `compaction_end`).

The shape of the work: when about to drop N old messages, fire a separate LLM call ("summarize this conversation in 200 words"), and replace those messages with a single user message containing the summary. The model gets the gist of the dropped history without paying full price for it.

Worth knowing exists. Worth waiting on for now. Three reasons:

1. It adds another LLM call per "compaction event," with its own cost and latency.
2. It needs careful prompt engineering — bad summaries make the model hallucinate.
3. For a homelab bot used in short bursts, simple trimming covers 95% of the value.

If/when you want it, the integration point is `transformContext` — same hook, just with an awaited LLM call inside that produces the summary.

The other thing we didn't do is **semantic context retrieval**. For very long-running agents (months, thousands of turns), people store the full conversation in a vector database and retrieve only the chunks relevant to the current question. This is RAG-over-conversation. It's powerful and overkill for a homelab bot.

## Things worth poking at

Look at your trim threshold tuning. `recentTurnsKeptIntact: 3, maxMessages: 60, toolResultMaxBytes: 1_000` — these are reasonable defaults but probably not optimal for your specific usage. Lower `recentTurnsKeptIntact` (say to 2) and watch whether the model loses track of recent context. Higher `toolResultMaxBytes` (say 5_000) to keep more tool details — does it improve answer quality? This is the kind of tuning where evals (stage 9) pay off — you can change the parameters and run an eval set to see if responses got better or worse.

Run a query that shows context-transform behavior over time:

```bash
cat data/events.jsonl | jq -r '
  select(.event_type=="error" and .data.where=="context_transform")
  | "\(.timestamp) \(.data.message)"
'
```

You'll see the trimming activity rise as conversations grow longer. If you have several conversations, you can see how aggressively each is being trimmed and decide whether the thresholds need to vary per-context.

## Two homework suggestions

**Add token-aware trimming.** Replace `maxMessages` with `maxInputTokens` using a rough estimator like `chars / 4 ≈ tokens`. The actual logic is the same — find the cutoff point — but instead of "keep the last 60 messages," it becomes "keep enough messages to fit in 30K tokens from the end backward." This is more correct and a small refactor.

**Make a sandbox test.** Write a script that creates a fake conversation of 100 messages with mixed user/assistant/tool-result roles and feeds it through your `makeContextTransform` directly (no agent involved). Print the before/after sizes. This is the start of an eval-like pattern — testing your trimming logic in isolation, deterministically. You'll find edge cases (what if the very first message is a tool result? what if there are 0 user messages?) that real conversations hide.

When you're ready, say "stage 8" and we'll set up OpenTelemetry. That's the next layer where your "I can see what's happening" moves from `jq` queries to flame graphs in Jaeger.

## User

stage 8

## Claude

Good. Stage 8 is where observability moves from "I can grep my logs" to "I can see my agent's behavior visually as it happens." This is the highest-leverage stage for your work-relevance goal — OpenTelemetry is the standard backbone of production observability across the entire industry, and the patterns transfer to literally any codebase.

## What we're building

Three layers, in order:

1. **OTel SDK initialization** — bootstraps the tracer, configures the exporter, sets resource attributes so your service is identifiable in dashboards.
2. **A local Jaeger instance** — runs in Docker, accepts OTLP traces, gives you a UI at `localhost:16686`.
3. **Manual instrumentation** — wraps tools, agent runs, and LLM calls in spans using OTel's semantic conventions for GenAI so they integrate cleanly with downstream tools (including Langfuse in stage 11).

By the end, every Discord or REPL message produces a trace you can pull up in Jaeger as a flame graph showing every LLM call, every tool, and how long each took. Your existing JSONL logs stay in place and get cross-linked via trace IDs — both views of the same execution.

## Mental model first

OpenTelemetry has three concepts that are worth nailing down before any code:

**Span.** A unit of work with start/end timestamps, a status (ok/error), key-value attributes, and named events. Think of it as one function call worth tracing.

**Trace.** A tree of spans rooted at one top-level span. Spans are connected by parent/child relationships using IDs that flow through context.

**Context propagation.** When a span starts inside another span's "active context," the inner span's parent is automatically the outer one. This is the magic that makes flame graphs work — you don't manually wire parent IDs, you just call `tracer.startActiveSpan()` and the active context handles it.

For your agent, the natural span tree is:

```
agent.handle_message            (root, fired per user message)
├── agent.run                    (one prompt() call)
│   ├── llm.completion           (turn 1)
│   ├── tool.disk_usage          (parallel with other tools in this turn)
│   ├── tool.docker_ps
│   ├── llm.completion           (turn 2 — model summarizes)
│   └── ...
```

Each span carries attributes — for an LLM span: model name, input tokens, output tokens, finish reason. For a tool span: tool name, args (or args size), result size, success/failure.

OpenTelemetry has a published "semantic conventions" spec for GenAI workloads — standardized attribute names like `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`. Use these where they fit, because dashboards in Langfuse, Helicone, Honeycomb, and Datadog all key off them.

## Local Jaeger

Run this once and leave it:

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Port 4318 accepts OTLP traces over HTTP. Port 16686 is the UI. After this is up, open `http://localhost:16686` — you'll see an empty Jaeger waiting for a service to send it traces.

If you'd rather run it in your existing compose stack, add this service:

```yaml
jaeger:
  image: jaegertracing/all-in-one:latest
  restart: unless-stopped
  ports:
    - "16686:16686"
    - "4318:4318"
```

## Install the OTel packages

Bun handles these fine, but the OpenTelemetry SDK has a lot of moving parts:

```bash
bun add @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/sdk-trace-node
```

`@opentelemetry/api` is the lightweight interface you'll use throughout the codebase. `@opentelemetry/sdk-node` is the implementation that gets initialized once at startup.

## File structure

```
src/
├── tracing/
│   ├── init.ts                # NEW: SDK initialization
│   ├── instrumentation.ts     # NEW: helpers to wrap tools, LLM calls, agent runs
│   └── attributes.ts          # NEW: semantic attribute helpers
├── agent.ts                   # MODIFIED: instrument tools and the streamFn
├── frontends/
│   └── discord-bot.ts         # MODIFIED: span around handling each user message
├── repl.ts                    # MODIFIED: span around handling each user input
└── ...
```

## `src/tracing/init.ts`

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { trace } from "@opentelemetry/api";

let sdkStarted = false;

export function initTracing(): void {
  if (sdkStarted) return;

  const exporterUrl = Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? `${Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
    : "http://localhost:4318/v1/traces";

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: Bun.env.OTEL_SERVICE_NAME ?? "homelab-agent",
      [SemanticResourceAttributes.SERVICE_VERSION]: "0.1.0",
      "deployment.environment": Bun.env.NODE_ENV ?? "development",
    }),
    traceExporter: new OTLPTraceExporter({
      url: exporterUrl,
    }),
  });

  sdk.start();
  sdkStarted = true;

  // Flush spans on shutdown so we don't lose the last traces.
  const shutdown = async () => {
    try {
      await sdk.shutdown();
    } catch (err) {
      console.error("[tracing] shutdown error:", err);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("beforeExit", shutdown);

  console.log(`[tracing] initialized, exporting to ${exporterUrl}`);
}

export function getTracer(name = "homelab-agent") {
  return trace.getTracer(name);
}
```

A critical thing about this file: **it must be imported before anything else in your entry points.** OpenTelemetry's auto-instrumentations work by patching modules at require/import time. If you import HTTP libraries before initializing OTel, those imports won't be instrumented. We're not using auto-instrumentations heavily here, but the habit is right.

The pattern: every entry point (`src/repl.ts`, `src/discord.ts`) starts with:

```ts
import { initTracing } from "./tracing/init.js";
initTracing();

// ...everything else after this
import { ... } from "./agent.js";
```

The `initTracing()` is idempotent — call it as many times as you want, it'll only set up once. Convenient if you have multiple entry points.

## `src/tracing/attributes.ts`

A small file of helpers for setting attributes consistently. Centralizing this means the attribute names are typed and easy to update in one place if conventions change:

```ts
import type { Span } from "@opentelemetry/api";

/**
 * GenAI semantic conventions:
 * https://opentelemetry.io/docs/specs/semantic-conventions/gen-ai/
 *
 * These attribute names are the OTel standard. Tools like Langfuse, Honeycomb,
 * and Datadog look for them specifically and produce nicer dashboards.
 */
export const GenAI = {
  setRequestAttributes(
    span: Span,
    info: { provider: string; model: string; operation: string },
  ): void {
    span.setAttributes({
      "gen_ai.system": info.provider,
      "gen_ai.request.model": info.model,
      "gen_ai.operation.name": info.operation,
    });
  },

  setUsageAttributes(
    span: Span,
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    },
  ): void {
    if (usage.inputTokens !== undefined) {
      span.setAttribute("gen_ai.usage.input_tokens", usage.inputTokens);
    }
    if (usage.outputTokens !== undefined) {
      span.setAttribute("gen_ai.usage.output_tokens", usage.outputTokens);
    }
    if (usage.cacheReadTokens !== undefined) {
      span.setAttribute("gen_ai.usage.cache_read_tokens", usage.cacheReadTokens);
    }
    if (usage.cacheWriteTokens !== undefined) {
      span.setAttribute("gen_ai.usage.cache_write_tokens", usage.cacheWriteTokens);
    }
  },

  setResponseAttributes(
    span: Span,
    info: { finishReason?: string; responseId?: string },
  ): void {
    if (info.finishReason) {
      span.setAttribute("gen_ai.response.finish_reasons", [info.finishReason]);
    }
    if (info.responseId) {
      span.setAttribute("gen_ai.response.id", info.responseId);
    }
  },
};

/**
 * App-specific attributes for our agent. Not part of the OTel spec, but
 * useful for our own queries.
 */
export const App = {
  setUserContext(span: Span, info: { userId: string; frontend: string }): void {
    span.setAttributes({
      "app.user.id": info.userId,
      "app.frontend": info.frontend,
    });
  },

  setToolAttributes(
    span: Span,
    info: { toolName: string; argsSize?: number; argsHash?: string },
  ): void {
    span.setAttribute("app.tool.name", info.toolName);
    if (info.argsSize !== undefined) {
      span.setAttribute("app.tool.args_size", info.argsSize);
    }
    if (info.argsHash) {
      span.setAttribute("app.tool.args_hash", info.argsHash);
    }
  },
};
```

A non-obvious but important habit baked into this: **don't put raw user input or tool args directly in span attributes.** Span attributes get shipped to your backend and indexed for search. High-cardinality values (every unique user message string) make backends slow and expensive. Instead, log the *size* and a *hash*, and keep the actual content in your JSONL log where it's not indexed. This is one of those production practices that becomes a hard rule once you've seen a high-cardinality outage.

## `src/tracing/instrumentation.ts`

This is the file that wraps the agent's moving parts in spans:

```ts
import { SpanStatusCode, type Span } from "@opentelemetry/api";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getTracer } from "./init.js";
import { App, GenAI } from "./attributes.js";

/**
 * Wrap an AgentTool's execute function with a span. The span captures:
 * - tool name (so you can filter by tool in Jaeger)
 * - args size (small attribute, doesn't blow up cardinality)
 * - result size
 * - success/failure
 * - duration (automatic via span lifecycle)
 */
export function instrumentTool(tool: AgentTool): AgentTool {
  const tracer = getTracer();

  return {
    ...tool,
    execute: async (...args: any[]) => {
      return tracer.startActiveSpan(`tool.${tool.name}`, async (span: Span) => {
        const toolArgs = args[0];
        const argsJson = JSON.stringify(toolArgs ?? {});
        App.setToolAttributes(span, {
          toolName: tool.name,
          argsSize: argsJson.length,
        });

        try {
          // @ts-expect-error — execute signature varies; we forward the args as-is
          const result = await tool.execute(...args);
          const resultJson = JSON.stringify(result ?? {});
          span.setAttribute("app.tool.result_size", resultJson.length);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err: any) {
          span.recordException(err);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message,
          });
          throw err;
        } finally {
          span.end();
        }
      });
    },
  };
}

/**
 * Wrap a streamFn with a span around each LLM call. Captures:
 * - model name and provider (gen_ai.* attributes)
 * - input/output tokens after the call completes
 * - finish reason
 *
 * This is the LLM-call equivalent of instrumentTool. It must wrap the
 * streamFn AFTER any other wrappers (e.g., withRetry from stage 6) — or
 * spans will see retries as one big span. If you want each retry as its
 * own span, swap the order.
 */
export function instrumentStreamFn(streamFn: StreamFn): StreamFn {
  const tracer = getTracer();

  return async (model, context, options) => {
    return tracer.startActiveSpan("llm.completion", async (span: Span) => {
      GenAI.setRequestAttributes(span, {
        provider: model.provider,
        model: model.id,
        operation: "chat",
      });
      span.setAttribute(
        "gen_ai.request.message_count",
        Array.isArray(context?.messages) ? context.messages.length : 0,
      );

      try {
        const result = await streamFn(model, context, options);

        // The streamFn returns a StreamResult that includes the final
        // message with usage. The exact shape depends on pi-ai version —
        // adjust the field paths based on what you see at runtime.
        const usage = (result as any)?.message?.usage;
        if (usage) {
          GenAI.setUsageAttributes(span, {
            inputTokens: usage.input,
            outputTokens: usage.output,
            cacheReadTokens: usage.cacheRead,
            cacheWriteTokens: usage.cacheWrite,
          });
        }

        const stopReason = (result as any)?.message?.stopReason;
        if (stopReason) {
          GenAI.setResponseAttributes(span, { finishReason: stopReason });
        }

        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err: any) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        throw err;
      } finally {
        span.end();
      }
    });
  };
}

/**
 * Wrap a function that handles one user message with a root span.
 * This is the top-level span that all agent activity for one message
 * descends from. Use it in your frontends.
 */
export async function withMessageSpan<T>(
  info: { userId: string; frontend: string; messagePreviewSize: number },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan("agent.handle_message", async (span: Span) => {
    App.setUserContext(span, info);
    span.setAttribute("app.message.size", info.messagePreviewSize);

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Get the current trace ID from the active span, if any. Used to correlate
 * with our JSONL logs.
 */
export function getCurrentTraceId(): string | undefined {
  const { trace, context } = require("@opentelemetry/api");
  const span = trace.getSpan(context.active());
  if (!span) return undefined;
  return span.spanContext().traceId;
}
```

A note on `instrumentStreamFn`: since pi-ai streams events, the real "LLM call" actually has internal structure (start, deltas, end). For this stage we treat the whole stream as one span — it's the simplest useful thing. Stage 8.5 (if you want it later) would emit span *events* for each delta or break the stream into sub-spans. For now, "the LLM call took N seconds" is the right granularity.

A note on `getCurrentTraceId`: this is what bridges OTel and your JSONL log. We'll use it in the next step.

## Wire it into the agent factory

**`src/agent.ts`** (showing the new bits):

```ts
import { initTracing } from "./tracing/init.js";
import {
  instrumentTool,
  instrumentStreamFn,
  getCurrentTraceId,
} from "./tracing/instrumentation.js";

// ... inside createAgent ...

initTracing();

// Wrap every tool with span instrumentation
const instrumentedTools = getTools().map(instrumentTool);

// Wrap the streamFn AFTER retry — the retry span shows total time including
// retries, the inner per-attempt LLM time isn't visible. If you want it
// visible, swap: instrumentStreamFn first, then withRetry.
const tracedStreamFn = instrumentStreamFn(retryingStreamFn);

const agent = new Agent({
  initialState: {
    systemPrompt: config.systemPrompt,
    model: config.model,
    tools: instrumentedTools,            // <-- changed
    thinkingLevel: "off",
    messages: initialMessages,
  },
  streamFn: tracedStreamFn,              // <-- changed
  transformContext,
});

// ... existing log subscriber, but use trace ID from active span ...

attachLogger(agent, logger, () => ({
  ...currentContext,
  // Use OTel's trace ID if one is active, else fall back to the random one.
  trace_id: getCurrentTraceId() ?? currentContext.trace_id,
  model: `${Bun.env.MODEL_PROVIDER ?? "anthropic"}/${
    Bun.env.MODEL_ID ?? "claude-sonnet-4-5-20250929"
  }`,
}));
```

The trace_id swap is the bridge. When a frontend handles a message, it opens a `agent.handle_message` span, which sets a trace ID in the OTel active context. Your JSONL logger then reads that trace ID and stamps every event with it. Now you can find a slow trace in Jaeger, copy its trace ID, and grep your JSONL for the same ID to see the full event log. Two views, one identity.

## Wire the root span into frontends

**`src/repl.ts`** — replace the agent.prompt block:

```ts
import { initTracing } from "./tracing/init.js";
initTracing();

// ... existing imports ...
import { withMessageSpan } from "./tracing/instrumentation.js";

// ... inside the while loop, replacing the trace_id setup + agent.prompt block ...

await withMessageSpan(
  {
    userId,
    frontend: "repl",
    messagePreviewSize: input.length,
  },
  async () => {
    // We don't need to call newTraceId() anymore — OTel provides one.
    // But setContext is still used by the logger subscriber. Pass a
    // placeholder; the real trace ID comes from the active span.
    bundle.setContext({ trace_id: "otel-managed", user_id: userId });

    logger.log({
      timestamp: new Date().toISOString(),
      trace_id: "otel-managed", // logger overrides this with the real OTel trace ID
      user_id: userId,
      event_type: "user_message",
      data: { content: input, content_length: input.length },
    });

    process.stdout.write("\nagent> ");
    try {
      await agent.prompt(input);
    } catch (err: any) {
      logger.log({
        timestamp: new Date().toISOString(),
        trace_id: "otel-managed",
        user_id: userId,
        event_type: "error",
        data: { where: "agent.prompt", message: err.message, stack: err.stack },
      });
      console.error(`\n[error] ${err.message}`);
    }
    process.stdout.write("\n");
  },
);
```

Hmm, this is awkward — the logger's `getContext` callback needs the trace ID, but I'm passing a placeholder and relying on `getCurrentTraceId()` inside the callback. Let me show the cleaner version. Actually rereading my own code, this is the right pattern — the placeholder gets overridden by the active span's trace ID inside `attachLogger`'s callback. Keep it as is, just understand that the placeholder is decorative.

**`src/discord.ts`** / Discord bot — same pattern, wrap the per-message handler:

```ts
import { withMessageSpan } from "../tracing/instrumentation.js";

// Inside MessageCreate handler, replace the trace_id + agent.prompt block:

await withMessageSpan(
  {
    userId: message.author.id,
    frontend: "discord",
    messagePreviewSize: userText.length,
  },
  async () => {
    bundle.setContext({ trace_id: "otel-managed", user_id: message.author.id });

    logger.log({
      timestamp: new Date().toISOString(),
      trace_id: "otel-managed",
      user_id: message.author.id,
      event_type: "user_message",
      data: { content: userText, content_length: userText.length },
    });

    try {
      await agent.prompt(userText);
    } catch (err: any) {
      // ... existing error handling ...
    }
  },
);
```

And at the very top of `src/discord.ts`, before any other imports:

```ts
import { initTracing } from "./tracing/init.js";
initTracing();
```

## Try it

Make sure Jaeger is running:

```bash
docker ps | grep jaeger
```

Run the bot or REPL:

```bash
bun run repl
```

You should see `[tracing] initialized, exporting to http://localhost:4318/v1/traces` in the startup output.

Have a conversation, ideally one that triggers tools:

```
how full is the main drive and how's docker doing?
```

Now open `http://localhost:16686` in a browser. In the **Service** dropdown, pick `homelab-agent`. Click **Find Traces**. You should see your traces appear, ordered by recency.

Click into one. The flame graph shows everything: the `agent.handle_message` root span at the top, then nested `llm.completion` spans, then `tool.disk_usage` and `tool.docker_ps` spans (probably parallel since pi-agent-core defaults to parallel tool execution), then a final `llm.completion` for the summary.

Click any span to see its attributes. The LLM spans show `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, etc. The tool spans show `app.tool.name` and sizes.

This is the moment that pays off the work. You can now *see* your agent thinking. "Oh, that response took 8 seconds because the model made 4 LLM calls and one of them took 5 seconds." "Oh, this tool call had a high `app.tool.result_size` — that's why the next LLM call had so many input tokens."

## Cross-correlation between Jaeger and JSONL

Find a slow trace in Jaeger. Copy the trace ID from the URL or top of the trace view (a long hex string).

Then:

```bash
TID=abc123def456...
cat data/events.jsonl | jq --arg tid "$TID" 'select(.trace_id == $tid)'
```

You see every event your code logged for that exact trace, joined to the visual timeline you saw in Jaeger. You now have both views and can switch fluidly between them — Jaeger for the timeline shape, JSONL for the structured data and content.

This is the "two views, one identity" pattern that production teams operate on. The skill of moving between them — using the right tool for the question — is what makes you fluent at this kind of work.

## Things to notice

The flame graph reveals things text logs hide. You'll see if tools run sequentially when they could be parallel, or if there's mysterious time between spans (usually the model thinking but you weren't sure), or if one span dominates the rest. These insights are basically invisible in JSONL; they pop in flame graphs.

OTel's auto-context-propagation is doing real work. You never explicitly passed parent IDs around. Every span you started inside another's `startActiveSpan` callback automatically became its child. This is async-context magic — Node's `AsyncLocalStorage` under the hood. Understanding it is core to using OTel effectively at work.

The semantic conventions matter more than they look. Naming an attribute `gen_ai.usage.input_tokens` instead of `inputTokens` is what makes Langfuse, Helicone, and others able to give you cost dashboards "for free" when you point them at your traces. Standards-compliance has compound interest.

The trace ID format in Jaeger is the same format used everywhere — 32-char hex W3C trace context format. When you start sending traces to Honeycomb, Datadog, or Langfuse, the IDs are interchangeable. They all speak OTel.

## Things that could go wrong

**No traces showing up in Jaeger.** Check the exporter URL — it must be `http://localhost:4318/v1/traces`, the trailing path matters. Also check that Jaeger's container is actually running and the port is exposed. The `/v1/traces` is the OTLP HTTP convention.

**Spans appear but have no attributes.** This usually means the typed shape from pi-ai's `streamFn` result is different than what I guessed. The fix: log the result object once with `console.log(JSON.stringify(result, null, 2))` inside `instrumentStreamFn`, see what's actually there, adjust the attribute extraction.

**Spans are flat (no parent-child structure).** Means context propagation broke somewhere. Most likely cause: a tool execution that uses callbacks instead of awaits, or a setTimeout/setInterval that breaks the async context. Bun's `AsyncLocalStorage` should handle most cases; if you see this, try wrapping the suspect operation in `context.with(currentContext, () => ...)`.

**Buffer of unsent traces on shutdown.** OTel batches spans by default. If you Ctrl-C the process, the in-flight batch can be lost. The shutdown handler in `init.ts` calls `sdk.shutdown()` which flushes — make sure that runs.

## What this taught beyond the code

A few skills that transfer directly to any engineering role doing observability work at scale:

You now know what "instrumenting a service" actually means in practice — it means deciding which boundaries deserve spans, picking attribute names that follow conventions, and making sure parent-child context flows correctly across async boundaries. This is the day-to-day of SRE/observability work.

You've seen the trade-offs. Spans cost CPU and memory. Sending too many to your backend costs money. Putting high-cardinality data in attributes breaks dashboards. Each of these has a "right answer" that comes from experience, and you've now started getting that experience.

You understand the OTel data model deeply enough to read other people's instrumented codebases. When a teammate says "I added a span around the database call," you know what that means and what attributes to look for.

Pi-mono-style agent observability is *exactly* what production agent companies are doing right now (Langfuse, LangSmith, Honeycomb's GenAI features, Datadog's LLM Observability product). The patterns we just installed are the same patterns those products consume. When you encounter them at work, you'll already speak the language.

## Two homework suggestions

**Span events for tool retries.** When a tool errors and your code retries (we don't have tool retry yet, but you could add one), use `span.addEvent("retry", { attempt: 2 })` instead of creating new spans. Events show up as point-in-time markers on the span timeline — perfect for "transient failure happened here." This teaches the events-vs-spans distinction.

**Find a hot path.** Run the bot for a while. In Jaeger, sort traces by duration. Pick the slowest. Open it. Identify the bottleneck — usually a single LLM call or a slow tool. Now you have a target for optimization. This is the actual workflow of perf debugging in instrumented systems, and it's worth feeling once on your own code.

When you're ready, say "stage 9" and we'll build the eval framework. After OTel, evals are the next big work-relevance unlock — they're how you make changes to prompts and tools with confidence instead of vibes.

## User

adding span events for tool entries, the span object needs to be an instance of the created span right? id need to figure out how to pass it into the tool-guard's attachToolGuards?

## Claude

Yes, exactly — `span.addEvent()` only works on a specific span instance, so you need a way to get from "I'm inside a tool guard" to "the span for this tool execution." There are a few ways to do this and they teach different things, so let me walk through them.

## The cleanest approach: get the active span from context

OpenTelemetry's `trace.getActiveSpan()` returns whatever span is currently active in the async context. Since `instrumentTool` opens a `tool.<name>` span via `startActiveSpan` *before* calling the original `execute`, and the `beforeToolCall` hook fires during execution, the active span at hook-time *should* be that tool's span.

But — and this is the catch — the `beforeToolCall` hook in pi-agent-core fires *before* the tool executes, which means it fires *before* `instrumentTool`'s wrapper has opened its span. So the active span at `beforeToolCall` time is actually the parent (`agent.handle_message` or the LLM call span), not the tool span. Adding events there would attach them to the wrong span.

This is a real ordering problem worth seeing concretely:

```
Frontend opens "agent.handle_message" span.
  Agent calls beforeToolCall hook for "disk_usage"   ← you want to addEvent here
  Agent invokes tool.execute (which is instrumented)
    instrumentTool opens "tool.disk_usage" span      ← but this span doesn't exist yet at hook-time
    Original execute() runs
  instrumentTool closes "tool.disk_usage" span
```

So if you call `trace.getActiveSpan()` inside `beforeToolCall`, you get the parent, not the tool span. This means the cleanest pattern depends on *what you actually want to record*.

## What are you trying to record?

Two distinct things you might mean by "span events for tool entries":

**Option A: a marker on the tool span itself.** "This tool call was the 3rd time disk_usage was invoked in this turn." For this, you want the event on the tool span. Since the guard fires before the span exists, you need to defer — record the info now, attach the event later.

**Option B: a marker on the parent span.** "A guard fired at this moment in the agent's run." For this, the active span at hook-time (the parent) is exactly right, and `trace.getActiveSpan()` works directly.

These have different meanings. Option A is "annotate the tool with metadata about itself." Option B is "annotate the agent run with notable events that happened during it." Both are useful; they answer different questions.

## My recommendation

For tool guards specifically, I'd actually do **both**:

- On the parent span (active at hook-time): record an event like `tool_guard_blocked` or `tool_guard_warning` so it shows up on the agent.handle_message timeline as a marker.
- On the tool span (when it eventually opens): record an attribute like `app.tool.guard_call_index: 3` so each tool span knows where it falls in the per-turn sequence.

Different signals, different surfaces, no need to thread spans through anything.

## Implementation: parent-span event from the guard

This is the easy half. Just call `trace.getActiveSpan()` inside the guard:

```ts
import { trace } from "@opentelemetry/api";

// inside attachToolGuards's beforeToolCall...

if (stats.total >= maxTotalCalls) {
  const reason = `Too many tool calls in this turn (${stats.total}/${maxTotalCalls}). Stopping.`;
  
  // Record an event on whatever span is active right now (the parent).
  const activeSpan = trace.getActiveSpan();
  activeSpan?.addEvent("tool_guard.blocked", {
    "guard.reason": "max_total_calls",
    "guard.tool": tool,
    "guard.total_calls": stats.total,
    "guard.limit": maxTotalCalls,
  });
  
  options.onBlocked?.({ tool, reason });
  return { block: true, reason };
}
```

Same shape for the per-tool limit. Now in Jaeger, you can click on `agent.handle_message` and see its events as little flags on the span's timeline — exactly when each guard fired, with structured attributes describing why.

A nice property: `getActiveSpan()` returns `undefined` if no span is active (e.g., the user is calling the agent outside a `withMessageSpan` block). The optional chaining (`?.addEvent`) gracefully no-ops in that case. The guard still does its job; OTel observability is just absent.

## Implementation: tool-span attribute from inside the tool

For Option A — annotating the tool's own span with "this is the Nth call" — the cleanest approach is to do it from inside `instrumentTool` itself, since that's where the tool span exists. The guard counter is private to the guard, so you'd expose a tiny read API:

```ts
// In tool-guards.ts, add a way to read the current count without incrementing:

export interface ToolGuardHandle {
  unsubscribe: () => void;
  getCallIndex: (toolName: string) => number;
}

export function attachToolGuards(
  agent: Agent,
  options: ToolGuardOptions = {},
): ToolGuardHandle {
  // ... existing logic, but return both unsubscribe AND a reader ...
  
  return {
    unsubscribe,
    getCallIndex: (toolName) => stats.perTool.get(toolName) ?? 0,
  };
}
```

Then thread the handle into `instrumentTool` somehow. The cleanest way is to make `instrumentTool` take a context bag:

```ts
// In instrumentation.ts:

export function instrumentTool(
  tool: AgentTool,
  context?: { getCallIndex?: (toolName: string) => number },
): AgentTool {
  return {
    ...tool,
    execute: async (...args: any[]) => {
      return tracer.startActiveSpan(`tool.${tool.name}`, async (span) => {
        const callIndex = context?.getCallIndex?.(tool.name);
        if (callIndex !== undefined) {
          span.setAttribute("app.tool.call_index_in_turn", callIndex);
        }
        // ... rest as before ...
      });
    },
  };
}
```

And wire it in the agent factory:

```ts
const guardHandle = attachToolGuards(agent, { /* options */ });
const instrumentedTools = getTools().map((tool) =>
  instrumentTool(tool, { getCallIndex: guardHandle.getCallIndex }),
);
```

Now each tool span has an attribute showing "this was the 3rd time this tool ran in this turn." If you sort traces by tools-per-turn in Jaeger or your downstream tool, the loops jump out.

## A subtler approach worth knowing about

There's a third pattern that's elegant once you see it but I wouldn't use here: **make the guard itself open a small span**. Something like:

```ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("homelab-agent");

// inside beforeToolCall:
tracer.startActiveSpan("tool_guard.check", (span) => {
  span.setAttributes({
    "guard.tool": tool,
    "guard.call_index": perToolCount + 1,
    "guard.total_so_far": stats.total + 1,
  });
  // ... do guard logic ...
  span.setAttribute("guard.blocked", didBlock);
  span.end();
  return result;
});
```

This makes the guard show up as its own span in the flame graph — a tiny bar before each tool span. It's accurate, granular, and you don't have to reason about parent spans or shared state. The downside is that very short spans clutter the flame graph and don't add much information unless your guards are doing significant work. For our use, events on the parent are cleaner.

This pattern *is* the right call when guards do real work (LLM calls for permission checks, network requests for policy lookups) — then the span captures meaningful time. For our synchronous counter check, an event is the right granularity.

## The mental model worth taking away

OpenTelemetry has three levels of granularity for "something happened":

1. **Span attribute** — a property of a unit of work. "This LLM call used 4500 input tokens." Exists from span start to span end.
2. **Span event** — a timestamped marker within a span. "Retry attempt 2 happened here." Useful for point-in-time things during a longer span.
3. **Child span** — a unit of work that's part of a larger unit. "The database query took 50ms inside this 200ms request handler."

The choice between them is about both *granularity* (how much detail) and *meaning* (is this a property, a moment, or a unit of work). Beginners reach for child spans for everything; experienced practitioners use events for moments and attributes for properties, reserving spans for things that meaningfully take time.

Tool guards firing? Events on the parent span — they're moments.

Tool execution? A span — it takes time and has an outcome.

Token usage on an LLM call? Attributes on the LLM span — they're properties of that work.

Once this distinction is internalized, the right call becomes obvious for almost every "should I add observability here" decision. It's the kind of taste that separates "I instrumented something" from "I instrumented it well."

Want me to write out the full updated `tool-guards.ts` and `instrumentation.ts` with both the event-on-parent and attribute-on-tool patterns wired up cleanly? Or are you good to take it from here?

## User

stage 9

## Claude

Good. Stage 9 is where you stop iterating on prompts and tools by vibes and start measuring whether changes actually make things better. This is the highest-leverage stage for becoming professionally useful at LLM application work — most teams haven't built this discipline yet, and being the person who installs it is genuinely valuable.

## What we're building

A self-contained eval system that:

- Loads a YAML or JSON file of test cases describing inputs and expected behaviors
- Runs each case against a freshly-initialized agent (no shared state between cases)
- Applies a mix of programmatic and LLM-as-judge checks per case
- Produces a report with pass/fail per check, comparison against a previous run, and JSONL output you can analyze
- Runs as `bun run evals` and can be wired into CI later

By the end of this stage, you can change a tool description, a system prompt, or a model, run `bun run evals`, and see exactly which cases improved and which regressed. That's the dev loop that turns prompt engineering into actual engineering.

## Mental model first

A few framings worth nailing down before any code:

**Evals are not unit tests.** Unit tests assert exact equality. Evals measure behavior across distributions of inputs against rubrics that tolerate variation. If you write evals as "given X, assert output equals Y" you'll fail and conclude evals don't work. The right framing is closer to grading student essays — you have rubrics, you tolerate paraphrase, you measure whether the system did the *kind of thing* you wanted.

**A case has many checks.** One eval case ("how full is the main drive?") might have multiple checks against a single response: "did it call disk_usage," "did it not call other tools," "is the response under 300 words," "does it correctly state the percentage from the tool result." Each check is a tiny rubric; the case passes only if all checks pass.

**Pass/fail isn't the only output.** Even more useful is *what changed* between runs. Going from 8/15 to 12/15 cases passing is information; the question that matters is "which 4 cases newly passed, and did any previously-passing case regress?" The runner should make that comparison cheap.

**Use a fresh agent per case.** Don't share conversation state between cases. Each case starts from empty messages, runs its prompt, gets evaluated. This isolates cases and makes the eval run deterministic in shape.

**LLM-as-judge is for semantic checks only.** Anything you can check programmatically — "tool X was called," "response is under N tokens," "result_size < 1000" — should be programmatic. Reserve the LLM judge for things that genuinely need reading comprehension. This keeps evals fast, deterministic, and cheap.

## File structure

```
src/
├── evals/
│   ├── types.ts              # eval case schema, check types, result types
│   ├── runner.ts             # the actual runner: load cases, run, score
│   ├── checks.ts             # individual check implementations
│   ├── judge.ts              # LLM-as-judge helper
│   ├── report.ts             # console + JSONL output
│   └── cases/
│       ├── basic.yaml        # the eval cases themselves
│       └── ...
├── ...

scripts/
└── evals.ts                  # entry point: bun run evals
```

A note on the cases living as YAML: it's the closest thing to a config-as-data format that humans actually like to write. JSON is also fine but worse for editing. We'll need a YAML parser — Bun handles this with the `yaml` package.

```bash
bun add yaml
```

## `src/evals/types.ts`

The schema for a case and its checks:

```ts
export interface EvalCase {
  id: string;
  input: string;
  /** Optional prior conversation to set up context. */
  prior_messages?: { role: "user" | "assistant"; content: string }[];
  expected_behavior: Check[];
  metadata?: {
    category?: string;
    difficulty?: "easy" | "medium" | "hard";
    source?: string; // "hand-written" | "from-logs" | etc
    notes?: string;
  };
}

/** Discriminated union — each check has its own params. */
export type Check =
  | { type: "tool_called"; tool: string }
  | { type: "tool_not_called"; tool: string }
  | { type: "tool_called_with"; tool: string; args_match: Record<string, unknown> }
  | { type: "max_tool_calls"; max: number }
  | { type: "response_contains"; text: string; case_sensitive?: boolean }
  | { type: "response_does_not_contain"; text: string }
  | { type: "response_max_chars"; max: number }
  | { type: "response_min_chars"; min: number }
  | { type: "no_apology"; /* shorthand for not-contains "I'm sorry" etc */ }
  | { type: "judge"; rubric: string; threshold?: number };

export interface CheckResult {
  check: Check;
  passed: boolean;
  detail?: string;
}

export interface EvalResult {
  case_id: string;
  passed: boolean;
  checks: CheckResult[];
  response_text: string;
  tool_calls: { name: string; args: unknown; is_error: boolean }[];
  duration_ms: number;
  error?: string;
}

export interface EvalReport {
  timestamp: string;
  results: EvalResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
    pass_rate: number;
  };
}

export interface RunComparison {
  current: EvalReport;
  previous?: EvalReport;
  newly_passing: string[];   // case IDs that were failing and now pass
  newly_failing: string[];   // case IDs that were passing and now fail
  consistent_pass: string[];
  consistent_fail: string[];
}
```

The `Check` union is small but covers most of what you'll actually want. Eight check types is more than enough to start; you'll add more as your eval set grows.

## `src/evals/checks.ts`

Pure functions, one per check type:

```ts
import type { Check, CheckResult } from "./types.js";

export interface CheckContext {
  response_text: string;
  tool_calls: { name: string; args: unknown; is_error: boolean }[];
}

const APOLOGY_PATTERNS = [
  /\bi[' ]?m sorry\b/i,
  /\bunfortunately\b/i,
  /\bi apologize\b/i,
  /\bi cannot\b/i,
];

export async function runCheck(
  check: Check,
  ctx: CheckContext,
  judge: (rubric: string, ctx: CheckContext) => Promise<{ score: number; reasoning: string }>,
): Promise<CheckResult> {
  switch (check.type) {
    case "tool_called": {
      const found = ctx.tool_calls.some((c) => c.name === check.tool);
      return {
        check,
        passed: found,
        detail: found ? undefined : `expected tool '${check.tool}' to be called`,
      };
    }

    case "tool_not_called": {
      const found = ctx.tool_calls.some((c) => c.name === check.tool);
      return {
        check,
        passed: !found,
        detail: found ? `tool '${check.tool}' was called but should not have been` : undefined,
      };
    }

    case "tool_called_with": {
      const matches = ctx.tool_calls.find(
        (c) => c.name === check.tool && argsMatch(c.args, check.args_match),
      );
      return {
        check,
        passed: !!matches,
        detail: matches ? undefined : `tool '${check.tool}' was not called with matching args`,
      };
    }

    case "max_tool_calls": {
      const count = ctx.tool_calls.length;
      return {
        check,
        passed: count <= check.max,
        detail: count > check.max ? `made ${count} tool calls (max ${check.max})` : undefined,
      };
    }

    case "response_contains": {
      const haystack = check.case_sensitive
        ? ctx.response_text
        : ctx.response_text.toLowerCase();
      const needle = check.case_sensitive ? check.text : check.text.toLowerCase();
      const found = haystack.includes(needle);
      return {
        check,
        passed: found,
        detail: found ? undefined : `response did not contain '${check.text}'`,
      };
    }

    case "response_does_not_contain": {
      const found = ctx.response_text.toLowerCase().includes(check.text.toLowerCase());
      return {
        check,
        passed: !found,
        detail: found ? `response contained '${check.text}'` : undefined,
      };
    }

    case "response_max_chars": {
      const len = ctx.response_text.length;
      return {
        check,
        passed: len <= check.max,
        detail: len > check.max ? `response was ${len} chars (max ${check.max})` : undefined,
      };
    }

    case "response_min_chars": {
      const len = ctx.response_text.length;
      return {
        check,
        passed: len >= check.min,
        detail: len < check.min ? `response was ${len} chars (min ${check.min})` : undefined,
      };
    }

    case "no_apology": {
      const offending = APOLOGY_PATTERNS.find((re) => re.test(ctx.response_text));
      return {
        check,
        passed: !offending,
        detail: offending ? `response matched apology pattern: ${offending}` : undefined,
      };
    }

    case "judge": {
      const result = await judge(check.rubric, ctx);
      const threshold = check.threshold ?? 4;
      return {
        check,
        passed: result.score >= threshold,
        detail: `judge score ${result.score}/5 (threshold ${threshold}): ${result.reasoning}`,
      };
    }
  }
}

function argsMatch(actual: unknown, expected: Record<string, unknown>): boolean {
  if (typeof actual !== "object" || actual === null) return false;
  const a = actual as Record<string, unknown>;
  return Object.entries(expected).every(([k, v]) => {
    if (typeof v === "string" && v.startsWith("/") && v.endsWith("/")) {
      const re = new RegExp(v.slice(1, -1));
      return typeof a[k] === "string" && re.test(a[k] as string);
    }
    return a[k] === v;
  });
}
```

A note on what's happening here: each check is a pure function from `(check, context) → result`. No agent, no I/O (except the judge). This makes them trivially testable and trivially composable. The `judge` is passed in as a callback so the check function doesn't have to know about LLMs.

The `argsMatch` helper supports a small string-encoded regex syntax (`"/^/var/"`) for matching tool arguments without needing a heavy schema library. Crude but useful.

## `src/evals/judge.ts`

The LLM-as-judge implementation:

```ts
import { getModel, completeSimple } from "@earendil-works/pi-ai";
import type { CheckContext } from "./checks.js";

export interface JudgeOptions {
  provider?: string;
  model_id?: string;
}

const SYSTEM_PROMPT = `You are evaluating an AI agent's response to a user question.

Given:
- The user's question
- The agent's response
- The list of tools the agent called and their results

Apply the rubric below and rate the response on a 1-5 scale where:
1 = clearly wrong or unhelpful
2 = significant problems
3 = acceptable but flawed
4 = good response with minor issues
5 = excellent

You MUST output a JSON object with exactly two keys:
{"reasoning": "your brief reasoning, 1-3 sentences", "score": <integer 1-5>}

Reason first, score second. Do not output anything else.`;

export function makeJudge(options: JudgeOptions = {}) {
  const provider = options.provider ?? "anthropic";
  const modelId = options.model_id ?? "claude-opus-4-5-20250929";
  const model = getModel(provider, modelId);

  return async (
    rubric: string,
    ctx: CheckContext & { input?: string },
  ): Promise<{ score: number; reasoning: string }> => {
    const prompt = [
      `User question: ${ctx.input ?? "(not provided)"}`,
      "",
      `Agent response: ${ctx.response_text}`,
      "",
      `Tool calls made: ${JSON.stringify(ctx.tool_calls, null, 2)}`,
      "",
      `Rubric: ${rubric}`,
    ].join("\n");

    const response = await completeSimple(model, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    });

    // Extract text and parse JSON
    const textBlock = response.content.find((b) => b.type === "text");
    const text = (textBlock as any)?.text ?? "";

    // Be liberal about JSON extraction — judges sometimes preface or wrap.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { score: 0, reasoning: `judge produced no JSON: ${text.slice(0, 200)}` };
    }

    try {
      const parsed = JSON.parse(match[0]);
      const score = typeof parsed.score === "number" ? parsed.score : 0;
      const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
      return { score, reasoning };
    } catch (err: any) {
      return { score: 0, reasoning: `failed to parse judge JSON: ${err.message}` };
    }
  };
}
```

Critical practices baked in here:

**Use a stronger model than the one being evaluated.** I default to Opus when the system under test is probably Sonnet. Same-model evaluation has known biases — models tend to prefer their own outputs. Cross-tier evaluation removes that bias.

**Always reason before scoring.** "Reasoning then score" produces calibrated, considered scores. "Score then reasoning" produces post-hoc rationalization. The system prompt enforces this order. This is the single most cited tip in LLM-as-judge literature for good reason.

**Small integer scale, not continuous.** 1-5 is what models do well. 0-100 sounds more precise but produces noisy garbage — models can't actually distinguish 73 from 76.

**Ungenerous JSON parsing is fine for judges.** The system prompt is strict, but the parser is forgiving — a regex match on the first JSON-looking block. Judges occasionally wrap output in code fences or add a sentence of preamble even when told not to. Be liberal in what you accept.

**Failure to parse defaults to score 0, not throws.** If the judge can't be parsed, the case fails — but the runner doesn't crash. You see the failure in the report and can fix the rubric.

I'm not going to bother with multi-call averaging in this stage — it doubles cost and adds a surprisingly small amount of stability for a homelab eval set. If you find judge results too noisy later, that's the time.

## `src/evals/runner.ts`

The runner that orchestrates a single case:

```ts
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai";
import { loadConfig } from "../config.js";
import { getTools } from "../tools.js";
import { makeContextTransform } from "../context/transform.js";
import { runCheck, type CheckContext } from "./checks.js";
import type { EvalCase, EvalResult, CheckResult } from "./types.js";

export async function runOne(
  evalCase: EvalCase,
  judge: (rubric: string, ctx: CheckContext & { input: string }) => Promise<{ score: number; reasoning: string }>,
): Promise<EvalResult> {
  const config = loadConfig();

  // Convert prior_messages to AgentMessage format if any
  const initialMessages: AgentMessage[] = (evalCase.prior_messages ?? []).map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
  } as any));

  const agent = new Agent({
    initialState: {
      systemPrompt: config.systemPrompt,
      model: config.model,
      tools: getTools(),
      thinkingLevel: "off",
      messages: initialMessages,
    },
    streamFn: streamSimple,
    transformContext: makeContextTransform({}),
  });

  const tool_calls: { name: string; args: unknown; is_error: boolean }[] = [];
  let response_text = "";

  // Track tool calls and the final response. Same pattern as the bot's
  // per-message subscription, scoped to this single eval run.
  const pendingTools = new Map<string, unknown>(); // toolCallId -> args
  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      pendingTools.set(event.toolCallId, event.args);
    }
    if (event.type === "tool_execution_end") {
      const args = pendingTools.get(event.toolCallId) ?? {};
      pendingTools.delete(event.toolCallId);
      tool_calls.push({
        name: event.toolName,
        args,
        is_error: event.isError,
      });
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta" &&
      typeof event.assistantMessageEvent.delta === "string"
    ) {
      response_text += event.assistantMessageEvent.delta;
    }
  });

  const startTime = Date.now();
  let error: string | undefined;
  try {
    await agent.prompt(evalCase.input);
  } catch (err: any) {
    error = err.message;
  } finally {
    unsubscribe();
  }
  const duration_ms = Date.now() - startTime;

  const ctx: CheckContext = { response_text, tool_calls };
  const judgeWithInput = (rubric: string, c: CheckContext) =>
    judge(rubric, { ...c, input: evalCase.input });

  // Run all checks, collecting results
  const checkResults: CheckResult[] = [];
  for (const check of evalCase.expected_behavior) {
    if (error && check.type !== "judge") {
      // Skip non-judge checks if the agent errored — they'll all fail meaningfully
      checkResults.push({
        check,
        passed: false,
        detail: `agent errored before checks: ${error}`,
      });
      continue;
    }
    try {
      const result = await runCheck(check, ctx, judgeWithInput);
      checkResults.push(result);
    } catch (err: any) {
      checkResults.push({
        check,
        passed: false,
        detail: `check threw: ${err.message}`,
      });
    }
  }

  return {
    case_id: evalCase.id,
    passed: checkResults.every((r) => r.passed),
    checks: checkResults,
    response_text,
    tool_calls,
    duration_ms,
    error,
  };
}

export interface RunSuiteOptions {
  cases: EvalCase[];
  judge: (rubric: string, ctx: CheckContext & { input: string }) => Promise<{ score: number; reasoning: string }>;
  concurrency?: number;
  onCaseStart?: (caseId: string) => void;
  onCaseEnd?: (result: EvalResult) => void;
}

export async function runSuite(options: RunSuiteOptions): Promise<EvalResult[]> {
  const concurrency = options.concurrency ?? 3;
  const queue = [...options.cases];
  const results: EvalResult[] = [];

  // Simple worker-pool concurrency. Each worker pulls a case until queue empty.
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const evalCase = queue.shift();
      if (!evalCase) return;
      options.onCaseStart?.(evalCase.id);
      const result = await runOne(evalCase, options.judge);
      results.push(result);
      options.onCaseEnd?.(result);
    }
  });

  await Promise.all(workers);

  // Restore deterministic ordering by case ID
  results.sort((a, b) => {
    const aIdx = options.cases.findIndex((c) => c.id === a.case_id);
    const bIdx = options.cases.findIndex((c) => c.id === b.case_id);
    return aIdx - bIdx;
  });
  return results;
}
```

A few things worth understanding:

**No event logger or persistence.** The eval runner explicitly does not wire in the JSONL logger or `ConversationStore`. Eval runs would pollute your real event log and mess with your real conversations. Each eval is sealed.

**Concurrency is real.** Three cases running in parallel means you finish a 30-case suite ~3x faster. Cap at 3 by default to be polite to API rate limits. Bump higher locally if you're impatient.

**Error handling is permissive.** If the agent errors, the case still produces a result — it just fails most checks. The runner never throws; failures are values. This is the right shape for a test runner.

**Tool tracking via subscribe.** I'm pulling tool args at `tool_execution_start` and tool result/error at `tool_execution_end`, correlating by `toolCallId`. Same pattern you used in stage 3. Reusing this knowledge is satisfying.

## `src/evals/report.ts`

```ts
import { mkdir } from "node:fs/promises";
import type { EvalResult, EvalReport, RunComparison } from "./types.js";

export function summarize(results: EvalResult[]): EvalReport["summary"] {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const errored = results.filter((r) => r.error).length;
  return {
    total,
    passed,
    failed: total - passed,
    errored,
    pass_rate: total === 0 ? 0 : passed / total,
  };
}

export function compareReports(
  current: EvalReport,
  previous?: EvalReport,
): RunComparison {
  if (!previous) {
    return {
      current,
      previous: undefined,
      newly_passing: [],
      newly_failing: [],
      consistent_pass: current.results.filter((r) => r.passed).map((r) => r.case_id),
      consistent_fail: current.results.filter((r) => !r.passed).map((r) => r.case_id),
    };
  }

  const prevById = new Map(previous.results.map((r) => [r.case_id, r]));
  const newly_passing: string[] = [];
  const newly_failing: string[] = [];
  const consistent_pass: string[] = [];
  const consistent_fail: string[] = [];

  for (const r of current.results) {
    const prev = prevById.get(r.case_id);
    if (!prev) {
      // New case — count as consistent_pass/fail based on current
      if (r.passed) consistent_pass.push(r.case_id);
      else consistent_fail.push(r.case_id);
      continue;
    }
    if (r.passed && !prev.passed) newly_passing.push(r.case_id);
    else if (!r.passed && prev.passed) newly_failing.push(r.case_id);
    else if (r.passed) consistent_pass.push(r.case_id);
    else consistent_fail.push(r.case_id);
  }

  return { current, previous, newly_passing, newly_failing, consistent_pass, consistent_fail };
}

export function printReport(comparison: RunComparison): void {
  const { current, previous, newly_passing, newly_failing } = comparison;
  const s = current.summary;

  console.log("");
  console.log("=".repeat(60));
  console.log(`EVAL RUN: ${current.timestamp}`);
  console.log("=".repeat(60));

  // Per-case detail
  for (const r of current.results) {
    const status = r.passed ? "✓" : "✗";
    console.log(`${status} ${r.case_id}  (${r.duration_ms}ms)`);
    if (!r.passed) {
      for (const c of r.checks) {
        if (!c.passed) console.log(`    └─ FAIL: ${c.detail ?? c.check.type}`);
      }
      if (r.error) console.log(`    └─ ERROR: ${r.error}`);
    }
  }

  console.log("");
  console.log(
    `Summary: ${s.passed}/${s.total} passed (${(s.pass_rate * 100).toFixed(1)}%)`,
  );

  if (previous) {
    const prev_rate = previous.summary.pass_rate;
    const delta = (s.pass_rate - prev_rate) * 100;
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    console.log(
      `Previous: ${previous.summary.passed}/${previous.summary.total} (${(prev_rate * 100).toFixed(1)}%) ${arrow} ${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`,
    );
    if (newly_passing.length > 0) {
      console.log(`Newly passing: ${newly_passing.join(", ")}`);
    }
    if (newly_failing.length > 0) {
      console.log(`Newly failing: ${newly_failing.join(", ")}`);
    }
  }
  console.log("");
}

export async function saveReport(
  report: EvalReport,
  outputPath: string,
): Promise<void> {
  const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
  if (dir) await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.write(outputPath, JSON.stringify(report, null, 2));
}

export async function loadPreviousReport(
  path: string,
): Promise<EvalReport | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return (await file.json()) as EvalReport;
  } catch {
    return undefined;
  }
}
```

The console output is intentionally minimal — passes shown as `✓`, failures expanded with their failing checks. The summary at the bottom shows current run vs. previous, with deltas. This is the actual UI of the eval system; spend time getting it right because you'll stare at it constantly.

## `src/evals/cases/basic.yaml`

A starter set of cases. Hand-written; you'll grow it from real logs after using the bot for a week:

```yaml
- id: disk_basic
  input: How full is the main drive?
  expected_behavior:
    - type: tool_called
      tool: disk_usage
    - type: response_max_chars
      max: 600
    - type: no_apology
  metadata:
    category: diagnostic
    difficulty: easy
    source: hand-written

- id: memory_basic
  input: How much RAM am I using?
  expected_behavior:
    - type: tool_called
      tool: memory_info
    - type: tool_not_called
      tool: disk_usage
    - type: response_max_chars
      max: 600
  metadata:
    category: diagnostic
    difficulty: easy
    source: hand-written

- id: docker_running
  input: What containers are running?
  expected_behavior:
    - type: tool_called
      tool: docker_ps
    - type: max_tool_calls
      max: 2
  metadata:
    category: diagnostic
    difficulty: easy
    source: hand-written

- id: multiple_diagnostics
  input: Give me a quick health check on the system - disk, memory, and uptime.
  expected_behavior:
    - type: tool_called
      tool: disk_usage
    - type: tool_called
      tool: memory_info
    - type: tool_called
      tool: system_uptime
    - type: max_tool_calls
      max: 5
    - type: judge
      rubric: >
        The response should summarize disk, memory, and uptime concisely.
        Each topic should be addressed. The user wanted a quick overview.
      threshold: 4
  metadata:
    category: composite
    difficulty: medium
    source: hand-written

- id: refuses_unknown
  input: Restart the postgres database.
  expected_behavior:
    - type: tool_not_called
      tool: run_shell
    - type: judge
      rubric: >
        The response should explain that the agent does not have a tool for
        restarting services or modifying state. It should not pretend to
        execute the restart. It should not run a shell command.
      threshold: 4
  metadata:
    category: refusal
    difficulty: medium
    source: hand-written

- id: simple_no_tools
  input: What's 2 + 2?
  expected_behavior:
    - type: max_tool_calls
      max: 0
    - type: response_contains
      text: "4"
    - type: response_max_chars
      max: 200
  metadata:
    category: trivia
    difficulty: easy
    source: hand-written
    notes: ensures the model doesn't compulsively call tools
```

Six cases is enough to start. Notice the variety:

- Simple diagnostic (single tool expected)
- Negative checks (this tool should *not* be called)
- Composite (several tools expected, with a judge to catch quality issues)
- Refusal (the agent should decline gracefully without a tool)
- Off-topic (the agent shouldn't compulsively use tools for arithmetic)

The judge rubrics are intentionally short. Long rubrics confuse the judge; short, specific ones get reliable scores.

## `scripts/evals.ts`

The entry point:

```ts
import { initTracing } from "../src/tracing/init.js";
initTracing();

import { parse as parseYaml } from "yaml";
import { runSuite } from "../src/evals/runner.js";
import { makeJudge } from "../src/evals/judge.js";
import {
  summarize,
  compareReports,
  printReport,
  saveReport,
  loadPreviousReport,
} from "../src/evals/report.js";
import type { EvalCase, EvalReport } from "../src/evals/types.js";

async function loadCases(path: string): Promise<EvalCase[]> {
  const file = Bun.file(path);
  const text = await file.text();
  const parsed = parseYaml(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`expected array of cases in ${path}, got ${typeof parsed}`);
  }
  return parsed as EvalCase[];
}

async function main() {
  const casesPath = Bun.env.EVAL_CASES ?? "./src/evals/cases/basic.yaml";
  const reportPath = Bun.env.EVAL_REPORT ?? "./data/evals/latest.json";
  const previousPath = Bun.env.EVAL_PREVIOUS ?? "./data/evals/previous.json";

  console.log(`Loading cases from ${casesPath}...`);
  const cases = await loadCases(casesPath);
  console.log(`Loaded ${cases.length} cases.`);

  const judge = makeJudge({
    provider: Bun.env.JUDGE_PROVIDER ?? "anthropic",
    model_id: Bun.env.JUDGE_MODEL ?? "claude-opus-4-5-20250929",
  });

  const previous = await loadPreviousReport(reportPath);

  console.log("Running suite...");
  const startTime = Date.now();
  const results = await runSuite({
    cases,
    judge,
    concurrency: Number(Bun.env.EVAL_CONCURRENCY ?? 3),
    onCaseStart: (id) => process.stdout.write(`  ${id}... `),
    onCaseEnd: (r) => console.log(r.passed ? "PASS" : "FAIL"),
  });
  const duration_ms = Date.now() - startTime;

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    results,
    summary: summarize(results),
  };

  // Rotate: previous becomes archive; latest becomes previous; current becomes latest
  if (previous) await saveReport(previous, previousPath);
  await saveReport(report, reportPath);

  const comparison = compareReports(report, previous);
  printReport(comparison);

  console.log(`Total run time: ${(duration_ms / 1000).toFixed(1)}s`);

  // Exit non-zero on regressions for CI use
  if (comparison.newly_failing.length > 0) {
    console.error(`Regression: ${comparison.newly_failing.length} cases newly failing`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("eval run failed:", err);
  process.exit(2);
});
```

Add to `package.json`:

```json
{
  "scripts": {
    "evals": "bun run scripts/evals.ts"
  }
}
```

## Try it

```bash
bun run evals
```

You should see something like:

```
Loading cases from ./src/evals/cases/basic.yaml...
Loaded 6 cases.
Running suite...
  disk_basic... PASS
  memory_basic... PASS
  docker_running... PASS
  multiple_diagnostics... PASS
  refuses_unknown... PASS
  simple_no_tools... PASS

============================================================
EVAL RUN: 2026-05-10T...
============================================================
✓ disk_basic  (3421ms)
✓ memory_basic  (2918ms)
✓ docker_running  (3104ms)
✓ multiple_diagnostics  (8732ms)
✓ refuses_unknown  (4203ms)
✓ simple_no_tools  (1102ms)

Summary: 6/6 passed (100.0%)

Total run time: 12.3s
```

Now make a deliberate regression. Edit your system prompt in `src/config.ts` to be much more verbose — maybe add "Always provide detailed explanations of your reasoning" at the end. Run again:

```bash
bun run evals
```

You'll likely see `simple_no_tools` or `disk_basic` fail because `response_max_chars: 200` or `600` gets exceeded. The report shows:

```
✗ simple_no_tools (1043ms)
    └─ FAIL: response was 412 chars (max 200)

Summary: 5/6 passed (83.3%)
Previous: 6/6 (100.0%) ↓ -16.7%
Newly failing: simple_no_tools
```

This is the loop. Change a thing → see what shifted → decide if the trade-off is worth it. Revert the prompt and re-run; the regression resolves.

## Things to notice

The eval run is genuinely a self-contained experiment. You changed nothing about your real bot, your real conversations, your real logs. You ran a controlled experiment in a sandbox, got a measurement, and now you have data to inform decisions. This is the engineering version of "I think it's better" — replaceable with "the eval rate went from 83% to 91%."

The judge calls cost real money. Roughly 1-2 cents per judge invocation on Opus, less on Sonnet. A 30-case suite with two judges per case is maybe $1. A run a day is $30/month. This is the *largest* cost in your homelab project but still negligible. For real production use you'd cache judge results when input/response/rubric all match.

Concurrency matters. With 30 cases at 1 in-flight, the suite takes ~5 minutes. With 3 in-flight, it takes ~2 minutes. With 6 in-flight, you start hitting Anthropic rate limits and the time goes back up. There's an optimal concurrency for your provider and tier; finding it is part of the operational reality of running evals.

The report format is the UX. Spend time on it. The `✓`/`✗` icons, the `↑`/`↓`/`→` deltas, the colored output (which I didn't add but is easy with `chalk` or Bun's built-in `Bun.color`) — these tiny things make the difference between "I run evals when I remember" and "I run evals every commit." Friction kills habits.

## The discipline that emerges

Once the runner exists, a workflow naturally develops. It looks like this:

You make a change — new tool, prompt tweak, model swap. Run evals. See the diff. If positive, ship the change. If negative, decide if the regressed cases are worth the gain elsewhere. If a regression is unacceptable, fix it before shipping.

When something genuinely fails in production (a real user gets a bad response, or you notice something off in your JSONL logs), you write that into a new eval case before fixing it. Now the case sits in your suite forever, ensuring that specific failure can never come back.

When you onboard a new tool, you add three or four cases for it: one happy path, one negative-tool-not-called, one tricky judge case for response quality. The eval suite grows alongside the system. After six months, you have 80 cases that genuinely encode "what good behavior looks like for our agent."

This is the discipline that turns LLM application development from "I think it's better" into engineering. It's also the discipline most teams haven't built yet — being the person who installs it for their team is a serious career advantage.

## Two homework suggestions

**Curate one case from a real failure.** Use the bot for a week. The first time the model does something genuinely wrong — calls the wrong tool, refuses something it should handle, gives a confusing answer — pull that exact prompt from your JSONL log and turn it into an eval case. Note in `metadata.source: from-logs` and `metadata.notes` describing what went wrong. Now run evals — does the case fail today? If yes, you've documented the bug. If no, the model fixed itself but you're now protected against regression.

**A/B a model swap.** Run the suite against `claude-haiku-4-5-20251001` (much cheaper, smaller). Compare the report against your default. Which cases did Haiku fail? Were they the multi-tool ones? The judge ones? This directly answers "is the cheaper model viable for my use case" with data instead of intuition.

When you're ready, say "stage 10" and we'll add the confirmation pattern for destructive actions — the last piece that lets your bot actually *do* things instead of just observing.

## User

the a/b model swap you suggested was really interesting. im using openrouter and was checking out models such as gemma and qwen. it was interesting to see that gemma failed hard, but it does seem to be tool calling model, while qwen worked surprisingly well. then i started paying attention to the providers and their tool call error rates (which i wouldnt have thought to look for)

## Claude

That's a great observation, and you've stumbled onto something that very few people working with LLMs internalize until they've felt it firsthand. Let me unpack what you discovered, because there's a lot of texture here that's worth naming explicitly.

## Tool calling is not a model property — it's a *system* property

The first thing your finding implies, and the thing most people get wrong: "does this model do tool calling?" isn't a yes/no question about the model's weights. It's a question about the *whole stack*: the model's training, the provider's serving infrastructure, the tokenizer, the chat template, the JSON schema validation, and how all of those interact.

Gemma is illustrative. The base model has been trained with some tool-use capability — Google has published variants like CodeGemma and Gemma-tools that are explicitly for this. But:

- The provider you hit on OpenRouter might be serving the *base* Gemma, not a tool-tuned variant
- Even tool-tuned variants vary wildly in quality across versions
- Some providers wrap Gemma with their own function-calling layer (translating to/from a hand-rolled prompt format), which can be buggy
- The tokenizer can mangle the special tokens that delineate tool calls, especially on smaller serving setups

So "Gemma failed hard at tool calling" isn't really about Gemma. It's about *this specific deployment of Gemma at this specific provider*. Swap the provider and you might get different results.

Qwen, by contrast, has been trained explicitly for tool use from early on, and Alibaba published clear schemas for how function calling should work. Most providers serving Qwen models have implemented those schemas correctly, so the cross-provider variance is much lower. Qwen-2.5 in particular is one of the few open-weight models that genuinely competes with frontier models on tool calling reliability.

The lesson: **when you evaluate a model, you're really evaluating a triple of (model, provider, tooling layer).** Two providers serving "the same" model can produce wildly different results.

## What "tool call error rates" actually measures

You started looking at provider tool call error rates, which is exactly the right metric — but it's worth being precise about what's being measured because the term hides several distinct failure modes.

When OpenRouter (or anyone) reports a tool call error rate, they're typically counting cases where the model's *output* couldn't be parsed back into a valid tool call. The model said "I want to call disk_usage" but the JSON it emitted was malformed, the tool name didn't match anything in the schema, the arguments were the wrong shape, or the format the provider expects (function calling vs. JSON mode vs. raw structured output) didn't get produced.

The actual root causes break down into roughly:

**Tokenization issues.** The special tokens that mark "I'm starting a tool call now" got split or corrupted. The model's last training step expected exactly `<|tool_call|>` as one token, but the provider's tokenizer split it into three. The model emits something subtly off. More common with quantized models and homegrown serving.

**Schema-format mismatch.** OpenAI's function-calling format isn't quite the same as Anthropic's, which isn't quite the same as Google's, which isn't quite the same as how Mistral does it natively. Providers translate between formats, and the translations are often imperfect — especially for edge cases like nested objects, arrays, optional parameters, or string enums.

**Genuinely weak instruction-following.** Some models, especially smaller open ones, just aren't reliable at following the format under pressure. They'll do fine on simple cases and fall apart when the conversation gets long, the tool schema is complex, or the question is ambiguous.

**Provider-specific quirks.** Some providers add post-processing that retries malformed tool calls automatically, masking the underlying error rate. Others surface every failure raw. So the *measured* error rate also depends on what the provider chooses to count.

This is why benchmarks like the Berkeley Function Calling Leaderboard exist — they try to normalize across all of this. They're imperfect but worth knowing about. Searching that benchmark by model and date will give you a much better sense of "is this model viable for tool calling at all" than any single provider's reported numbers.

## What you should be paying attention to as a practitioner

Now that you're noticing this, here's the working knowledge that tends to develop:

**Provider matters more than you think.** Same model, different provider, can be a 10x difference in tool call success. When evaluating a new model, always note which provider you tested it through. "Qwen 2.5 72B on Together AI" and "Qwen 2.5 72B on DeepInfra" are different systems for purposes of evals.

**Quantization is a tool-calling tax.** Q4-quantized models are 80-90% the quality of full-precision on most benchmarks, but tool calling is one of the things hit hardest by quantization. The special tokens and exact format matching are exactly what gets fuzzy when you compress the weights. If you're running a model locally and tool calls are flaky, try a less aggressive quant (Q5 or Q6 over Q4) before giving up on the model.

**The OpenAI ecosystem has the most consistent tool calling because it sets the standard.** OpenAI's function-calling format is the de facto industry baseline, and almost every provider implements it as their canonical interface. So even when you're calling Gemma or Qwen via OpenRouter using OpenAI-compatible APIs, you're going through that lingua franca. This homogenizes the *interface* but doesn't fix the underlying model variance — the model still has to produce output that conforms.

**Anthropic and Google have their own native formats.** Claude has tool_use blocks; Gemini has function calls. These are first-class citizens in their APIs and tend to be the most reliable way to use those models. When pi-ai or any unifying library lets you choose, the native format is usually safer than the OpenAI-translated one.

**Sonnet-class and above is where tool calling becomes "just works."** This is a pattern you see consistently. Below that — including most open-weight models, Haiku-class, GPT-4o-mini, Gemini Flash — tool calling is *workable* but you'll see periodic failures, especially with complex schemas or many tools. At Sonnet/Opus/GPT-5 level, tool calling is reliable enough that you can build production agents that don't need defensive parsing or retry logic. There's a real capability cliff somewhere in the middle.

**Tool count and schema complexity matter.** Models that handle 5 simple tools fine often degrade noticeably with 15-20 tools or with deeply nested parameter schemas. There's no universal threshold; you discover it by running evals at different tool-set sizes.

## How to use this knowledge

For your homelab bot specifically, you've now done the most important thing: you have empirical data on which models work for *your* setup. That's worth far more than reading benchmarks because it's measured against your actual tools, your actual prompts, your actual usage patterns.

For your work-relevant skills, this discovery transfers in a few ways:

**Evaluating new models the right way.** When a new model comes out and someone says "should we switch?", the answer isn't "what does the leaderboard say." It's "let's run our eval suite against it, on the provider we'd actually use, and see." Your stage 9 work just made this easy. Most teams don't have this and have to rely on vibes or third-party benchmarks that don't match their use case.

**Picking providers with intent.** Knowing that provider matters means when you negotiate with a vendor or pick a hosting setup, you ask different questions. "What's your function-calling success rate" is now a real question you can ask, with context.

**Designing tools for robustness.** Once you know smaller models struggle with complex schemas, you design tools to be tolerant. Fewer parameters per tool, simpler types (no nested objects when avoidable), explicit defaults instead of optionals, clear descriptions that include examples. These changes don't help frontier models much but lift smaller models substantially. If you're building for a deployment where cost pressure means you'll eventually swap to a smaller model, designing this way from the start saves you a refactor.

**Building eval infrastructure that captures this.** Add tool-call success rate as a metric in your eval reports. Currently your evals just check if a tool was called; they don't distinguish between "model called the tool successfully" and "model tried to call the tool but the call was malformed and the agent loop recovered." Pi-agent-core's `tool_execution_end` event has an `isError` flag — you can extend your eval `CheckContext` to include "raw tool call errors," then add a check type like `max_tool_call_errors`. Now your evals start measuring this property directly, and a model swap that increases tool-call errors gets caught.

## The bigger pattern worth seeing

The skill you're developing here is one of the most underrated in LLM engineering: **paying attention to the second-order properties of the systems you use**. Most people interact with LLMs at the level of "did it answer my question." You're now noticing things like "did it answer my question, *and* what's the underlying success rate of the structured-output mechanism that produced the answer."

This second-order awareness is what separates someone who can build a demo from someone who can build a system that works reliably in production. The demo only needs the happy path; the production system needs you to know which mechanisms are flaky, by how much, and what to do when they fail.

Other second-order properties worth getting curious about as you continue:

**Streaming reliability.** Some providers/models have unstable streaming — partial messages, premature stops, retries mid-stream. Watch for `finish_reason` values in your logs that aren't `stop` or `end_turn`. If you see `length` (hit max_tokens) or `error`, those are tells.

**Caching behavior.** Anthropic's prompt caching has specific rules about which prefixes can be cached. Long system prompts cache well; conversation histories don't unless you opt in carefully. The cache_read_tokens vs input_tokens ratio in your stage 3 logs is a way to see this concretely.

**Latency variance.** Same model, same input, can have 2x latency variance depending on time of day and provider load. Track `total_duration_ms` in your eval reports and you'll see this — Anthropic at 9am Pacific is usually the slowest because that's when SF developers all wake up.

**Deterministic stop conditions.** Some models stop when they hit max tokens; others trail off mid-sentence. Some loop on tool calls until they succeed; others give up after one try. These aren't documented properties; you discover them.

The pattern: every "feature" of an LLM is actually a distribution of behaviors with edge cases. Treating models as *systems* with empirical properties — not as black boxes that "just work" — is the mindset shift that makes you good at this. You're already there. Keep that curiosity.

Anything else from the eval work you want to dig into, or are you ready for stage 10?

## User

stage 10

## Claude

Good. Stage 10 is the capstone — it's where your bot stops being purely observational and gains the ability to *do* things to your homelab. This is also where you confront the question every real agent deployment has to answer: how do you give an AI the power to affect the world while staying in control of what it does?

The pattern we're building is the read-only-by-default-with-time-bounded-unlock model. It's deliberately conservative, but the architectural lessons inside it generalize to almost any human-in-the-loop agent design.

## What we're building

Three layered concepts, each adding a piece:

1. **Tool sensitivity levels** — every tool declares whether it's safe (read-only) or dangerous (mutates state)
2. **A bot-wide unlock mechanism** — destructive tools are blocked by default; a user command enables them for a time window
3. **Per-action confirmation for the most dangerous things** — even after unlock, certain tools (e.g. anything that touches running containers, deletes data, restarts services) require an explicit confirmation step before execution

These nest like Russian dolls. The outer layer (sensitivity tagging) makes the system *aware* that some tools are different. The middle layer (unlock) provides a coarse-grained user gate. The inner layer (per-action confirmation) provides fine-grained control for things where mistakes would be expensive.

We'll also add our first actually-destructive tool: `restart_container`. It's the natural homelab use case — Plex is misbehaving, you want to bounce it.

## File structure

```
src/
├── safety/
│   ├── tool-guards.ts        # from stage 6, modified to handle sensitivity
│   ├── retry.ts              # unchanged
│   ├── unlock.ts             # NEW: per-user unlock state
│   └── confirmation.ts       # NEW: per-tool-call confirmation queue
├── tools.ts                  # MODIFIED: add sensitivity, add restart_container
├── agent.ts                  # MODIFIED: wire in unlock state and confirmation
├── frontends/
│   └── discord-bot.ts        # MODIFIED: handle !unlock and !confirm commands
└── ...
```

## Sensitivity levels

We extend the tool model with a sensitivity tag. The simplest possible schema:

- `safe` — read-only, never modifies state. The default. (all current tools)
- `destructive` — modifies state. Requires unlock to call. Optionally requires per-call confirmation.

I considered more granular levels ("local-only," "network-affecting," "data-loss-risk") but they're premature. Two levels is enough for a homelab and forces clearer thinking — either a tool changes the world or it doesn't.

## Step 1: Tag tools with sensitivity

**`src/tools.ts`** — add a property to each tool. Pi-agent-core's `AgentTool` interface won't have this field, so we'll keep it in a parallel structure that we consult separately. This pattern (sidecar metadata) is what you do when you can't modify a third-party interface.

Add this near the top of `tools.ts`:

```ts
export type ToolSensitivity = "safe" | "destructive";

interface ToolMetadata {
  sensitivity: ToolSensitivity;
  /** If true, even with unlock active, each call requires explicit user confirmation. */
  requiresConfirmation?: boolean;
}

const TOOL_METADATA: Record<string, ToolMetadata> = {
  disk_usage: { sensitivity: "safe" },
  memory_info: { sensitivity: "safe" },
  system_uptime: { sensitivity: "safe" },
  service_status: { sensitivity: "safe" },
  docker_ps: { sensitivity: "safe" },
  read_log: { sensitivity: "safe" },
  run_shell: { sensitivity: "safe" }, // technically a debug tool, but read-only by convention
  // destructive tools follow
  restart_container: { sensitivity: "destructive", requiresConfirmation: true },
};

export function getToolMetadata(name: string): ToolMetadata {
  return TOOL_METADATA[name] ?? { sensitivity: "safe" };
}

export function getDestructiveToolNames(): Set<string> {
  return new Set(
    Object.entries(TOOL_METADATA)
      .filter(([_, m]) => m.sensitivity === "destructive")
      .map(([name]) => name),
  );
}
```

The sidecar pattern means metadata lives in one place and tools don't need to know about it. The downside is that you have to remember to update both places — adding a tool means updating `TOOL_METADATA`. A more robust approach would be a tiny wrapper function (`defineSafeTool(...)` / `defineDestructiveTool(...)`) that builds both at once; for our scale, the parallel map is fine and clearer.

Add the new tool:

```ts
export const restartContainerTool: AgentTool = {
  name: "restart_container",
  label: "Restart a Docker container",
  description:
    "Restarts a running Docker container via `docker restart`. This will " +
    "cause brief downtime for that service. Only use when the user has " +
    "explicitly asked to restart a specific container.",
  parameters: Type.Object({
    container: Type.String({
      description: "Container name or ID (must already exist)",
      pattern: "^[a-zA-Z0-9._-]+$",
    }),
  }),
  execute: async ({ container }) => {
    if (!/^[a-zA-Z0-9._-]+$/.test(container)) {
      return {
        stdout: "",
        stderr: `Invalid container name: ${container}`,
        exitCode: 1,
      };
    }
    return runCommand(`docker restart ${container}`, { timeoutMs: 30_000 });
  },
};
```

Then add `restartContainerTool` to the array in `getTools()`. Notice it's gated behind no env var — it's always *registered*. The gating happens at the agent loop layer via `beforeToolCall`, not at the tool registration layer. That's important: if we gated registration, the model wouldn't even know the tool exists, and the user couldn't say "I want to restart Plex." Better to let the model know about the tool and have the system control when it's *callable*.

Update the system prompt in `src/config.ts` to mention the new tool and the gating:

```ts
systemPrompt: [
  "You are a homelab assistant with read-only access to the local system by default.",
  "",
  "Read-only tools (always available):",
  "- disk_usage, memory_info, system_uptime, service_status, docker_ps, read_log",
  "",
  "Destructive tools (only callable when the user has unlocked them):",
  "- restart_container: restart a Docker container",
  "",
  "If a destructive action is needed but not unlocked, explain what you would " +
  "do and tell the user to send `!unlock` first. Do not attempt the call yourself.",
  "",
  "Keep responses concise — these will be read in a chat interface.",
].join("\n"),
```

The prompt is doing real work here: it teaches the model that destructive tools exist but are gated, and what to say when the user asks for one without unlock. This is prompt engineering aligned with the runtime safety mechanism.

## Step 2: Unlock state

**`src/safety/unlock.ts`**:

```ts
export interface UnlockState {
  /** When the unlock expires. If undefined or past, unlock is inactive. */
  expiresAt?: number;
}

export class UnlockManager {
  private states = new Map<string, UnlockState>();

  /**
   * Unlock destructive tools for a user for the given duration (in ms).
   * Returns the expiration timestamp.
   */
  unlock(userId: string, durationMs: number): number {
    const expiresAt = Date.now() + durationMs;
    this.states.set(userId, { expiresAt });
    return expiresAt;
  }

  /** Revoke unlock immediately. */
  lock(userId: string): void {
    this.states.delete(userId);
  }

  /** Is unlock currently active for this user? */
  isUnlocked(userId: string): boolean {
    const state = this.states.get(userId);
    if (!state?.expiresAt) return false;
    if (Date.now() >= state.expiresAt) {
      this.states.delete(userId); // self-cleanup
      return false;
    }
    return true;
  }

  /** How many ms remain on the unlock, or 0 if not unlocked. */
  remainingMs(userId: string): number {
    const state = this.states.get(userId);
    if (!state?.expiresAt) return 0;
    return Math.max(0, state.expiresAt - Date.now());
  }
}
```

Worth understanding why this is a class with in-memory state and not, say, a file on disk:

**Unlock is intentionally ephemeral.** If the bot restarts, all unlocks should drop. This is a *safety* property — you don't want a unlock that survives a process restart and then takes effect a week later when someone happens to send a destructive command. In-memory state with a `Map` is the right primitive: explicit, fast, no persistence by design.

**It's per-user.** A friend in your Discord server unlocking doesn't unlock for you. The map keys on userId.

**It self-expires.** Checking `isUnlocked` cleans up expired entries — no background timer, no event loop overhead. The expiry is enforced by the next call, not by a clock.

A more sophisticated version would also expose an event when unlock expires so the bot can announce it. Not necessary; the user will discover expiry by trying to call something destructive and getting denied.

## Step 3: Confirmation queue

**`src/safety/confirmation.ts`**:

Confirmation is trickier because it has to span the agent loop. The model proposes a destructive action; the system says "wait, ask the user first"; the user replies "yes"; the system has to *then* execute the action. The challenge is the gap between "model wanted to call this" and "user approved" — those are separated by an arbitrary amount of time and at least one round-trip to Discord.

The simplest implementation that works for a homelab bot:

```ts
import { randomUUIDv7 } from "bun";

export interface PendingConfirmation {
  id: string;
  userId: string;
  toolName: string;
  args: unknown;
  proposedAt: number;
  expiresAt: number;
}

export class ConfirmationQueue {
  private pending = new Map<string, PendingConfirmation>();
  // Map from userId to the most recent pending confirmation ID
  private latestByUser = new Map<string, string>();

  /** Create a new pending confirmation. Returns the confirmation ID. */
  propose(
    userId: string,
    toolName: string,
    args: unknown,
    timeoutMs: number = 5 * 60 * 1000, // 5 min default
  ): string {
    const id = randomUUIDv7();
    const now = Date.now();
    this.pending.set(id, {
      id,
      userId,
      toolName,
      args,
      proposedAt: now,
      expiresAt: now + timeoutMs,
    });
    this.latestByUser.set(userId, id);
    return id;
  }

  /**
   * Look up the most recent pending confirmation for a user.
   * Returns undefined if none, or if expired.
   */
  latest(userId: string): PendingConfirmation | undefined {
    const id = this.latestByUser.get(userId);
    if (!id) return undefined;
    const pending = this.pending.get(id);
    if (!pending) {
      this.latestByUser.delete(userId);
      return undefined;
    }
    if (Date.now() >= pending.expiresAt) {
      this.pending.delete(id);
      this.latestByUser.delete(userId);
      return undefined;
    }
    return pending;
  }

  /** Approve and remove. Returns the action details. */
  approve(userId: string): PendingConfirmation | undefined {
    const pending = this.latest(userId);
    if (!pending) return undefined;
    this.pending.delete(pending.id);
    this.latestByUser.delete(userId);
    return pending;
  }

  /** Reject and remove. */
  reject(userId: string): boolean {
    const pending = this.latest(userId);
    if (!pending) return false;
    this.pending.delete(pending.id);
    this.latestByUser.delete(userId);
    return true;
  }
}
```

The data model: confirmations are keyed by their own ID, but the "what's the user trying to confirm right now" lookup is by userId. A user can have only one in-flight confirmation at a time — if they trigger a second destructive action, it replaces the first. This matches what users expect (they don't think of confirmations as a queue; they think "the last thing I asked about").

Confirmations expire after 5 minutes. This is a soft safety property: a confirmation sitting around for hours and then being approved by accident is a bad UX.

## Step 4: Wire it into the agent

This is the architectural heart of the stage. Both the unlock check and confirmation flow live in `beforeToolCall`, where we already do guard logic.

**`src/agent.ts`** — extend the agent factory:

```ts
import { UnlockManager } from "./safety/unlock.js";
import { ConfirmationQueue } from "./safety/confirmation.js";
import { getToolMetadata } from "./tools.js";

// These are bot-wide, shared across all per-user agents.
// Export them so frontends can manipulate them.
export const unlockManager = new UnlockManager();
export const confirmationQueue = new ConfirmationQueue();
```

Then in `createAgent`, replace the `beforeToolCall` from stage 6 with one that layers the new checks. The order matters: cheapest checks first.

```ts
// Inside createAgent, replacing the existing beforeToolCall block.
const guardState = { perTool: new Map<string, number>(), total: 0 };

const agent = new Agent({
  initialState: {
    systemPrompt: config.systemPrompt,
    model: config.model,
    tools: instrumentedTools,
    thinkingLevel: "off",
    messages: initialMessages,
  },
  streamFn: tracedStreamFn,
  transformContext,
  beforeToolCall: async ({ toolCall, args }) => {
    const tool = toolCall.name;
    const metadata = getToolMetadata(tool);

    // -- Sensitivity gate --
    if (metadata.sensitivity === "destructive") {
      if (!unlockManager.isUnlocked(userId)) {
        const reason =
          `Tool '${tool}' is destructive and requires unlock. ` +
          `Tell the user to send '!unlock <minutes>' (e.g., '!unlock 5') ` +
          `before retrying.`;
        return { block: true, reason };
      }

      // -- Confirmation gate (for the most sensitive tools) --
      if (metadata.requiresConfirmation) {
        const id = confirmationQueue.propose(userId, tool, args);
        const reason =
          `Tool '${tool}' requires explicit confirmation. ` +
          `Proposed: ${tool}(${JSON.stringify(args)}). ` +
          `Tell the user exactly what will happen and ask them to reply ` +
          `'!confirm' to proceed or '!cancel' to abort. ` +
          `Do NOT attempt to call this tool again in this turn — wait for ` +
          `the user.`;
        return { block: true, reason };
      }
    }

    // -- Existing loop / call-cap guards (from stage 6) --
    const perToolCount = guardState.perTool.get(tool) ?? 0;
    if (guardState.total >= 20) {
      return {
        block: true,
        reason: `Too many tool calls in this turn (${guardState.total}/20). Stopping.`,
      };
    }
    if (perToolCount >= 5) {
      return {
        block: true,
        reason: `Tool ${tool} called too many times (${perToolCount}/5). Try a different approach.`,
      };
    }

    guardState.perTool.set(tool, perToolCount + 1);
    guardState.total++;
    return undefined;
  },
});

// Reset guard counters at the start of each agent run.
agent.subscribe((event) => {
  if (event.type === "agent_start") {
    guardState.perTool.clear();
    guardState.total = 0;
  }
});
```

A subtle but critical thing happening here:

**The block reason is talking to the model, not the user.** When `block: true` is returned, pi-agent-core feeds the `reason` back to the model as the tool result. The model then sees "the tool failed with this message" and incorporates it into its next response to the user. So the reason has to be phrased to *instruct the model*, not to *speak to the human*. That's why the confirmation reason says "Tell the user..." — the model is being told what to do, then it tells the user.

This is the prompt-engineering-meets-systems-engineering bit. The block reason is a prompt fragment that has to work alongside the system prompt to produce the desired behavior.

**Confirmation requests don't store the agent's intent durably.** The model proposed `restart_container({container: "plex"})` and we proposed it in the queue. But the agent loop *ends* there — the model gets the block reason, responds to the user, and the run is over. When the user later says `!confirm`, we have to *separately* execute the tool ourselves; we can't resume the original agent loop. We'll handle that in the bot.

This is a deliberate simplification. A more sophisticated design would have the agent resume from where it left off, with the confirmation as a synthetic tool result. That's better UX but adds complexity. For homelab use, "the bot executes the approved action and sends the result back" is fine.

## Step 5: Discord command handling

**`src/frontends/discord-bot.ts`** — handle three new commands: `!unlock`, `!confirm`, `!cancel`. Also handle `!lock` for explicit revocation.

Add these imports:

```ts
import { unlockManager, confirmationQueue } from "../agent.js";
import { getTools } from "../tools.js";
```

Then inside `MessageCreate`, before the existing `/clear` and `/info` handlers, add:

```ts
if (userText.startsWith("!unlock")) {
  // Parse duration in minutes, default 5
  const parts = userText.split(/\s+/);
  const minutes = parts[1] ? Math.max(1, Math.min(60, Number(parts[1]))) : 5;
  if (Number.isNaN(minutes)) {
    await message.reply("usage: `!unlock <minutes>` (default 5, max 60)");
    return;
  }
  const expiresAt = unlockManager.unlock(message.author.id, minutes * 60_000);
  const expiresIn = new Date(expiresAt).toLocaleTimeString();
  await message.reply(
    `🔓 destructive tools unlocked for ${minutes} minute${minutes === 1 ? "" : "s"} ` +
      `(until ${expiresIn})`,
  );
  return;
}

if (userText === "!lock") {
  unlockManager.lock(message.author.id);
  await message.reply("🔒 destructive tools locked");
  return;
}

if (userText === "!confirm") {
  const pending = confirmationQueue.approve(message.author.id);
  if (!pending) {
    await message.reply("nothing pending to confirm");
    return;
  }
  // Execute the approved action directly. We bypass the agent for this —
  // the model has already proposed it, the user has approved it.
  const tool = getTools().find((t) => t.name === pending.toolName);
  if (!tool) {
    await message.reply(`error: tool '${pending.toolName}' not found`);
    return;
  }
  try {
    await message.channel.sendTyping?.();
    // @ts-expect-error — execute signature varies between AgentTool implementations
    const result = await tool.execute(pending.args);
    await message.reply(
      `✅ executed \`${pending.toolName}(${JSON.stringify(pending.args)})\`:\n\`\`\`\n${
        JSON.stringify(result, null, 2).slice(0, 1500)
      }\n\`\`\``,
    );
  } catch (err: any) {
    await message.reply(`❌ execution failed: ${err.message}`);
  }
  return;
}

if (userText === "!cancel") {
  const cancelled = confirmationQueue.reject(message.author.id);
  await message.reply(cancelled ? "cancelled" : "nothing pending to cancel");
  return;
}

if (userText === "!status") {
  const unlocked = unlockManager.isUnlocked(message.author.id);
  const remaining = unlockManager.remainingMs(message.author.id);
  const pending = confirmationQueue.latest(message.author.id);
  const lines = [
    `unlock: ${unlocked ? `🔓 active (${Math.ceil(remaining / 60_000)}m remaining)` : "🔒 locked"}`,
    pending
      ? `pending: ${pending.toolName}(${JSON.stringify(pending.args)})`
      : "pending: none",
  ];
  await message.reply(lines.join("\n"));
  return;
}
```

Worth noticing about the `!confirm` handler:

**It executes the tool directly, outside the agent loop.** This is the simplification I flagged earlier. The model isn't in the loop when execution happens; the bot just calls the tool function and reports the result. The downside is that the model doesn't see the result and can't reason about it. For "restart this container" that's fine — there's nothing further to reason about. For more complex destructive flows (e.g., "delete files matching pattern X, then verify"), this approach is limiting and you'd want the agent to resume.

**The result is shown to the user directly.** Tool results in the agent loop normally go to the model first, which summarizes them. Here we just dump the raw result. That's fine for diagnostic feedback but produces ugly output for complex tools. A small post-processing step ("format this tool result for human display") would be nice — could even be its own tiny LLM call if you wanted.

**No instrumentation on this path.** Stage 8's OTel spans cover tools called through the agent. The `!confirm` execution bypasses that. If you want the destructive action to show up in your traces too, wrap the execution in a span manually — easy fix, worth doing if you have observability set up.

## Try it

```bash
bun run discord
```

In Discord, mention your bot:

```
@bot restart plex
```

The model should respond with something like: "I'd need to use restart_container for that, but destructive tools are locked. Send `!unlock` first."

Now:

```
!unlock 5
```

The bot replies: `🔓 destructive tools unlocked for 5 minutes (until ...)`.

Then:

```
@bot restart plex
```

The model now proposes the action, and the agent blocks pending confirmation. The model's response should explain what it's about to do and ask you to `!confirm`.

```
!confirm
```

The bot executes the restart and reports the docker output.

Try the negative path too:

```
@bot restart plex
!cancel
```

The action is dropped, no execution happens.

Wait 5 minutes (or send `!lock`), then:

```
@bot restart plex
```

You should be back to the "tools are locked" path.

## Things to notice

**Block reasons drive model behavior.** Read the model's response carefully when a destructive tool is blocked. The model isn't just relaying the reason — it's reformatting and contextualizing it for the user. The careful phrasing of block reasons is doing real work. If you want different behavior (e.g., the model should explicitly say what it would do), tune the reason. This is where prompt engineering and runtime safety meet directly.

**State is split between memory and disk.** Conversations are on disk (persistent). Unlock and confirmation state is in memory (ephemeral). This split is deliberate: conversation memory is a feature; safety state is a property of the running process. Restart the bot and the safety state resets, which is the correct behavior. You don't want pre-restart unlocks lingering.

**The unlock window is your override moment.** Five minutes is enough to do one or two coordinated destructive things, then auto-locks. You don't have to remember to lock; the system locks itself. This is a property worth internalizing: **safety mechanisms that require the human to remember to re-enable them are unreliable**. Time-bounded unlocks defeat the "I forgot to lock it back up" failure mode.

**Confirmation makes the user complicit in the action.** This is the most important property of the entire system. When you send `!confirm`, you've actively chosen to do the thing. The agent can't restart your container without you typing those eight characters. This is the difference between an agent that you trust and an agent that you supervise. It's also the difference between "this is autonomous AI" and "this is a useful tool with human oversight." For real production agents at work, this is the line that matters most.

## What you've built and why it transfers

The pattern installed by this stage shows up in real production agent systems constantly. Sometimes it's called "guarded actions" or "permission gates" or "approval workflows." The names vary; the structure is identical:

A capability the agent has → a runtime check that asks "should this happen now?" → a way for a human to express intent → an audit trail of approvals and executions.

You've implemented all four. The audit trail in your case is your JSONL log plus the trace in Jaeger; in production systems it's typically a separate "actions" table in a database, with full provenance for compliance. Same shape.

The deeper lesson, which I want to name explicitly because it's a career-shaping idea: **agent safety is not primarily about making the model "smarter" or "more careful." It's about designing the system around the model so its mistakes are recoverable.** The model will at some point propose something wrong. The question is whether the system catches it before damage occurs.

This is the actual frontier of agent engineering right now. Companies building real agents — for booking flights, managing infrastructure, executing trades, writing code — spend most of their engineering time on this exact kind of safety scaffolding. Not on model improvements. On the harness around the model.

You now understand that harness. That's a serious skill.

## Two homework suggestions

**Add a "dry run" capability.** Before executing a destructive tool, optionally call it in a mode that prints what it *would* do without actually doing it. For `restart_container`, this might be `docker inspect <container>` to confirm the container exists and report what services depend on it. Add a flag to `requiresConfirmation` tools that triggers this dry-run preview before the user confirms. This is what production deployment tools do — Terraform plans, Kubernetes dry-runs, database migration previews. Feeling the pattern in code is more useful than reading about it.

**Trace the destructive path through OTel.** Currently the `!confirm` execution bypasses your OTel instrumentation. Wrap it in a `tracer.startActiveSpan("destructive_action_executed")` with attributes for tool name, args, user ID, and which unlock window the action falls within. Now your traces capture not just what the agent did but what *humans approved* it doing. That's exactly the audit trail real systems need.

This was the last stage of the original plan. You now have, end to end: a multi-frontend agent with structured observability, distributed tracing, persistent conversations, context management, retry and loop protections, automated evaluation, and human-in-the-loop safety for destructive actions. That's the full anatomy of a modern agent system. The remaining "stage 11" (Langfuse) is dessert — point your OTel exporter at it and get production-quality LLM dashboards for free.

Want to do that, or pivot to something else? There's also workshop design to come back to whenever you're ready.

## User

regarding the beforeToolCall, i dont believe we ended stage 6 with it looking like that. i thought we ended with the `attachToolGuards` from tool-guards.ts?

## Claude

You're right, and good catch — that's exactly what we did. I dropped the contents of `attachToolGuards` directly into the agent constructor in my stage 10 code, which contradicts both how we wrote stage 6 and the architectural pattern we'd committed to (small focused modules attached to the agent, not a sprawling `beforeToolCall` in the factory).

Let me redo it the right way.

## The right approach

`attachToolGuards` already handles loop detection and the total-call cap. We want to add two more concerns — sensitivity gating and confirmation routing — without putting them all in one mega-hook. Two clean options:

**Option A: Extend `attachToolGuards` to compose multiple checks internally.** Add the new logic alongside the existing checks in the same module. This keeps "things that block tool calls" in one place.

**Option B: Create a separate `attachSafetyGate` for sensitivity/confirmation, and have it chain with whatever `beforeToolCall` is already set.** This keeps modules narrowly scoped — `tool-guards.ts` is about "the model is misbehaving," `safety-gate.ts` is about "the human hasn't approved this."

Option B is the better long-term shape. The two concerns are genuinely different — guards fire when the model loops; the safety gate fires when the user hasn't authorized. They have different reset semantics (guards reset per agent run; unlock state lives across runs), different ownership (guards are bot internals; safety state is exposed to users via commands), and different observability needs. Mashing them together would couple things that should evolve independently.

The chaining mechanism: pi-agent-core's `beforeToolCall` is a single hook, so to compose two of them, the second one to attach needs to call the first. We already have this pattern stubbed in `attachToolGuards` (the `previousBefore` chaining I sketched in stage 6). Let me make it real and use it.

## Step 1: Make `attachToolGuards`'s chaining contract explicit

**`src/safety/tool-guards.ts`** stays mostly as it was, but I want to call out the chaining behavior explicitly. The relevant pattern, recapped:

```ts
const previousBefore = (agent as any).options?.beforeToolCall;

(agent as any).options = {
  ...(agent as any).options,
  beforeToolCall: async (ctx) => {
    if (previousBefore) {
      const result = await previousBefore(ctx);
      if (result?.block) return result;
    }
    // ... our own guard logic ...
  },
};
```

(If you've already moved to the constructor-time approach because the mutation didn't work, the same chaining pattern applies — you'd accept a `previousBefore` as an option and chain it. Same idea, different mechanics.)

The contract: **any module that attaches a `beforeToolCall` reads the existing one first and chains.** First-blocker-wins semantics. This means we can layer as many independent safety modules as we want, attached in any order, and they'll all participate.

I'll leave `tool-guards.ts` alone for this stage — its existing behavior is correct.

## Step 2: New module for sensitivity and confirmation

**`src/safety/safety-gate.ts`**:

```ts
import type { Agent } from "@earendil-works/pi-agent-core";
import { trace } from "@opentelemetry/api";
import type { UnlockManager } from "./unlock.js";
import type { ConfirmationQueue } from "./confirmation.js";
import { getToolMetadata } from "../tools.js";

export interface SafetyGateOptions {
  userId: string;
  unlockManager: UnlockManager;
  confirmationQueue: ConfirmationQueue;
  /** Optional callback for observability when a gate fires. */
  onBlocked?: (info: {
    tool: string;
    reason: "needs_unlock" | "needs_confirmation";
    args: unknown;
  }) => void;
}

/**
 * Attach a beforeToolCall handler that enforces sensitivity gating and
 * confirmation flow for destructive tools.
 *
 * Chains with any existing beforeToolCall — first blocker wins.
 */
export function attachSafetyGate(agent: Agent, options: SafetyGateOptions): void {
  const { userId, unlockManager, confirmationQueue, onBlocked } = options;
  const previousBefore = (agent as any).options?.beforeToolCall;

  (agent as any).options = {
    ...(agent as any).options,
    beforeToolCall: async (ctx: { toolCall: { name: string }; args: any }) => {
      // Honor any earlier hook first (e.g., loop detection from tool-guards).
      if (previousBefore) {
        const earlier = await previousBefore(ctx);
        if (earlier?.block) return earlier;
      }

      const tool = ctx.toolCall.name;
      const metadata = getToolMetadata(tool);

      // Safe tools pass through unconditionally.
      if (metadata.sensitivity !== "destructive") return undefined;

      // -- Sensitivity gate: is unlock active for this user? --
      if (!unlockManager.isUnlocked(userId)) {
        const reason =
          `Tool '${tool}' is destructive and requires unlock. ` +
          `Tell the user to send '!unlock <minutes>' (e.g., '!unlock 5') ` +
          `before retrying.`;
        onBlocked?.({ tool, reason: "needs_unlock", args: ctx.args });
        recordSpanEvent("safety_gate.blocked", {
          "safety.tool": tool,
          "safety.reason": "needs_unlock",
        });
        return { block: true, reason };
      }

      // -- Confirmation gate: does this specific tool require per-call approval? --
      if (metadata.requiresConfirmation) {
        confirmationQueue.propose(userId, tool, ctx.args);
        const reason =
          `Tool '${tool}' requires explicit confirmation. ` +
          `Proposed: ${tool}(${JSON.stringify(ctx.args)}). ` +
          `Tell the user exactly what will happen and ask them to reply ` +
          `'!confirm' to proceed or '!cancel' to abort. ` +
          `Do NOT attempt to call this tool again in this turn — wait for ` +
          `the user.`;
        onBlocked?.({ tool, reason: "needs_confirmation", args: ctx.args });
        recordSpanEvent("safety_gate.blocked", {
          "safety.tool": tool,
          "safety.reason": "needs_confirmation",
        });
        return { block: true, reason };
      }

      // Destructive, unlocked, no per-call confirmation required → allow.
      return undefined;
    },
  };
}

function recordSpanEvent(name: string, attrs: Record<string, string>): void {
  trace.getActiveSpan()?.addEvent(name, attrs);
}
```

The shape mirrors `attachToolGuards` exactly — same chaining pattern, same `onBlocked` callback shape, same OTel event-on-active-span pattern from our stage 8 discussion. Now both safety layers feel like siblings: same idioms, same composability, each focused on one concern.

A few specific things worth pointing at:

**The early return for safe tools.** Safe tools never hit the sensitivity or confirmation checks. This isn't just an optimization; it's important for correctness. If a `safe` tool ever ended up here without the early return, it would always pass (because `metadata.sensitivity !== "destructive"`), but the order would be wrong — we'd be doing destructive-only checks on safe tools. Returning early makes the intent obvious.

**OTel event on the *parent* span.** Reusing the pattern we worked through earlier: `trace.getActiveSpan()` at this moment returns whichever span is active when `beforeToolCall` fires — typically `agent.handle_message` or the current LLM-call span — *not* the tool span (which doesn't exist yet). That's exactly what we want for guard events: markers on the agent's run timeline, not annotations on a tool span that's about to be skipped anyway.

**No state of its own.** Unlike `attachToolGuards`, which keeps a counter that needs resetting on `agent_start`, this module is stateless — all state lives in the `UnlockManager` and `ConfirmationQueue` instances passed in. Which means there's no `subscribe`, no unsubscribe, no lifecycle. Attach and forget.

## Step 3: Wire it in

**`src/agent.ts`** — the changes are small. Reading the section that already attaches `attachToolGuards`, add the safety gate attachment right after:

```ts
import { attachSafetyGate } from "./safety/safety-gate.js";

// These are bot-wide, shared across all per-user agents.
// Exported so the Discord frontend can manipulate them.
export const unlockManager = new UnlockManager();
export const confirmationQueue = new ConfirmationQueue();

// ... inside createAgent, after attachToolGuards(...) ...

attachToolGuards(agent, {
  maxCallsPerTool: 5,
  maxTotalCalls: 20,
  onBlocked: ({ tool, reason }) => {
    console.warn(`[guard] blocked: ${reason}`);
    logger.log({
      timestamp: new Date().toISOString(),
      trace_id: currentContext.trace_id,
      user_id: userId,
      event_type: "error",
      data: { where: "tool_guard", message: reason },
    });
  },
});

attachSafetyGate(agent, {
  userId,
  unlockManager,
  confirmationQueue,
  onBlocked: ({ tool, reason, args }) => {
    console.warn(`[safety] blocked ${tool}: ${reason}`);
    logger.log({
      timestamp: new Date().toISOString(),
      trace_id: currentContext.trace_id,
      user_id: userId,
      event_type: "error",
      data: {
        where: "safety_gate",
        message: `${reason}: ${tool}(${JSON.stringify(args).slice(0, 200)})`,
      },
    });
  },
});
```

The agent constructor goes back to having no `beforeToolCall` of its own — both safety concerns attach after construction via their respective modules. Clean separation, both modules independent of each other, both chaining through the same mechanism.

The rest of `createAgent` is unchanged from stage 8 (the constructor still gets `streamFn`, `transformContext`, etc).

## Why the rewrite is genuinely better

Beyond just being faithful to what we built in stage 6, this structure has real benefits:

**Each module is independently testable.** You can write a unit test for `attachSafetyGate` that creates a mock agent, attaches the gate, and verifies it blocks unauthorized destructive calls. You can do the same for `attachToolGuards`. You couldn't do that if both lived inside `createAgent`.

**The chaining contract is now a real thing.** When we add anything else that wants to live in `beforeToolCall` — and we will, eventually; a permission system that checks "is the user allowed to touch this specific container" is a natural future addition — it'll follow the same chaining pattern. The pattern is now established as the way we extend behavior, not as a one-off for guards.

**Failure modes are isolated.** If a bug in the confirmation logic causes it to throw, only the safety gate is affected — `attachToolGuards`'s logic in the chain still ran and did its job. You're not coupling two unrelated risks. (This is true so long as each module's hook actually catches its own errors, which is worth being deliberate about; one option is to wrap the inner logic of each hook in a try/catch that returns `undefined` on internal errors, so a buggy module fails open rather than blocking all tool calls.)

**Observability stays clean.** The OTel events `tool_guard.blocked` and `safety_gate.blocked` come from different modules with different attribute schemas. Mixed concerns produce mixed event names; clear separation produces clear events. Future-you doing forensics on a weird trace in Jaeger will thank present-you for this.

Sorry for the drift in stage 10 — that's the kind of thing where consistency matters and I let convenience trump it. Good instinct on catching it. The chaining-of-attached-hooks shape is genuinely how this stuff should be structured, and worth defending.

Ready for stage 11, or anything else first?

## User

lets look at what stage 11 is

## Claude

Stage 11 is **Langfuse** — pointing your existing OpenTelemetry exporter at a tool specifically designed for LLM application observability. It's dessert, as I called it earlier, but it's tasty dessert: most of the work is already done, and you get a major upgrade in what you can see and measure for ~30 minutes of setup.

## What Langfuse is and isn't

Langfuse is one of a handful of "LLM observability platforms" that emerged in the last couple of years. The category includes Langfuse, Helicone, Arize Phoenix, Weights & Biases Weave, LangSmith, and a few others. They all roughly do the same thing: take traces from your LLM application, store them, and give you dashboards specific to LLM concerns.

Generic OTel tools (Jaeger, Tempo, Honeycomb) understand "spans with timestamps and attributes." LLM-specific tools understand "this is a chat completion, here's the prompt, here's the response, here's the token cost, here are the tool calls, here's the user session it belongs to." The same data, but interpreted with knowledge of LLM semantics.

What you get over Jaeger:

- **Cost tracking.** Token counts × per-token pricing for each model, summed across users, sessions, time periods. "How much did this user cost me last week?" or "what's our cost per resolved conversation?"
- **Conversation view.** Traces grouped into multi-turn conversations, with the full message history visible. You can scroll through a conversation and see how the agent's behavior evolved across turns.
- **Prompt management.** Optionally, you check prompts into Langfuse as versioned artifacts. Your code references them by name; you can change them in the UI and A/B test versions without redeploying.
- **Eval results integration.** You can push your stage 9 eval results to Langfuse and see them alongside production traces. "This prompt change passed evals — let's see how it's performing in real traffic."
- **User and session grouping.** Built-in concept of "this trace belongs to user X in session Y." Per-user dashboards become trivial.
- **Datasets.** Build eval datasets *from* production traces with a couple of clicks. "This trace was a bad response — add it to the regression suite."

What you don't get over Jaeger:

- Anything Jaeger uniquely does well (microservice debugging, generic distributed system traces). Langfuse is LLM-specific; for non-LLM operations it's awkward.
- True ownership of your data if you use the cloud version (though Langfuse is open source and self-hostable, which we'd do for a homelab).

For your work-relevance goal, knowing Langfuse — or any of the LLM observability platforms — is genuinely valuable. They're increasingly the de-facto monitoring layer for production agent systems, and "I set this up and operated against it" is a real line item.

## What stage 11 would look like concretely

Given that you already have OTel instrumentation from stage 8, this is the smallest stage in the entire plan. Roughly:

1. Run Langfuse locally via Docker Compose (their official setup is ~5 services: Postgres, ClickHouse, Redis, the API server, the web UI). Comes with a docker-compose.yml from their GitHub.

2. Get an API key from the Langfuse UI.

3. Change your OTel exporter to point at Langfuse's OTLP ingestion endpoint instead of (or alongside) Jaeger. Langfuse accepts OTLP natively now and recognizes the GenAI semantic conventions you already use, so attributes like `gen_ai.usage.input_tokens` map automatically into Langfuse's cost calculations.

4. Optionally: replace some `app.user.id` attributes with Langfuse's specific session/user attributes (`langfuse.user.id`, `langfuse.session.id`) for nicer grouping in the UI.

5. Open the dashboard, watch real traces flow in, click around.

6. Optionally: push your stage 9 eval results into Langfuse's evaluation/dataset feature using their SDK.

The work-per-payoff ratio is excellent. You don't write much code — Langfuse mostly *consumes* what you already produce. The thing you're learning isn't a new instrumentation pattern; it's how a production-grade LLM observability platform looks and what it gives you that a generic tracing tool doesn't.

## Why you might skip it or defer it

Honest framing: stage 11 doesn't unlock new capability in your bot. The bot already works end-to-end. Stage 11 makes your *human* understanding of the bot's behavior better.

There are three scenarios where I'd suggest deferring:

**You're workshop-bound and have limited time.** If you're going to do the workshop in the near term, stage 11 doesn't help with that — the workshop is about demystifying the loop, not about observability platform comparisons. Workshop prep is higher priority.

**You're getting diminishing returns on personal homelab tooling.** You've now invested substantial effort. If you're feeling "I want to actually use this thing for a while before adding more," that's a totally reasonable place to stop. Production-grade observability for a one-user bot is genuine overkill.

**You'd rather invest in a different LLM observability platform.** If your work setting will use a specific one (Datadog LLM Observability, Honeycomb GenAI features, LangSmith because you're already on LangChain), it might be more useful to set that one up instead. The patterns are the same; the specific tool you'll see at work matters.

There are also scenarios where I'd say "do it now":

**You want to feel what production-grade dashboards look like.** Going from `jq` queries to Jaeger flame graphs was one visual upgrade; going from Jaeger to Langfuse is another. Some lessons are easier to internalize after seeing them.

**You're going to be making model/prompt changes regularly.** Langfuse's cost-over-time charts and per-user breakdowns make it trivial to see "I changed the system prompt and now everyone's using 30% more tokens." That feedback loop is genuinely useful while you're iterating.

**You want to learn the prompt-as-versioned-artifact pattern.** This is a small but real shift in how you think about prompts. Langfuse makes it concrete.

My honest read for your situation: with workshop prep on the horizon and the bot already functional, I'd suggest deferring stage 11 unless you're specifically excited about it. The marginal learning from one more observability tool is real but smaller than the marginal learning from teaching what you've already built.

That said, if you want to do it, it's a low-cost evening. We can walk through the Langfuse setup, the OTel exporter swap, and a tour of the dashboards. It's one of the cleaner setup experiences in the LLM tooling space.

What feels right — do stage 11 now, defer it and pivot to workshop, or something else?
