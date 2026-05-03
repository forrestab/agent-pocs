import type { Agent } from "@mariozechner/pi-agent-core";
import type { AgentLogger } from "./logger";

interface TurnState {
    turn_index: number;
    turn_started_at: number;
    tool_calls_in_turn: number;
    pending_tool_starts: Map<string, { started_at: number; args: unknown; }>; // toolCallId -> startedAt
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

export function attachLogger(agent: Agent, logger: AgentLogger, getContext: () => { trace_id: string; user_id: string; model: string }): () => void {
    let trace: TraceState | null = null;

    const unsubscribe = agent.subscribe((event) => {
        const context = getContext();
        const now = Date.now();
        const baseEvent = {
            timestamp: new Date().toISOString(),
            trace_id: context.trace_id,
            user_id: context.user_id,
        };

        switch (event.type) {
            case "agent_start": {
                trace = {
                    trace_id: context.trace_id,
                    user_id: context.user_id,
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
                if (!trace) {
                    break;
                }

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
                        model: context.model,
                    }
                });

                break;
            }

            case "message_update": {
                if (trace && event.assistantMessageEvent?.type === "text_delta" && typeof event.assistantMessageEvent.delta === "string") {
                    trace.response_buffer += event.assistantMessageEvent.delta;
                }

                break;
            }

            // Pull token usage off completed assistant messages.
            case "message_end": {
                if (!trace) {
                    break;
                }

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
                if (!trace?.current_turn) {
                    break;
                }

                trace.current_turn.pending_tool_starts.set(event.toolCallId, { started_at: now, args: event.args });

                break;
            }

            case "tool_execution_end": {
                if (!trace?.current_turn) {
                    break;
                }

                const pending = trace.current_turn.pending_tool_starts.get(event.toolCallId);

                trace.current_turn.pending_tool_starts.delete(event.toolCallId);
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

            case "turn_end": {
                if (!trace || !trace.current_turn) {
                    break;
                }

                const turn = trace.current_turn;
                const duration_ms = now - turn.turn_started_at;

                logger.log({
                    ...baseEvent,
                    event_type: "turn_end",
                    data: {
                        turn_index: turn.turn_index,
                        model: context.model,
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
                if (!trace) {
                    break;
                }

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

                trace = null; // ready for next turn

                break;
            }
        }
    });

    return unsubscribe;
}
