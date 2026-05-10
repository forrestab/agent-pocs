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
