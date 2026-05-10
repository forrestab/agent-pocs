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
        result_preview: string; // truncated for log size
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

export interface ContextTransformEvent extends BaseEvent {
    event_type: "context_transform";
    data: {
        inputCount: number;
        outputCount: number;
        toolResultsTrimmed: number;
        messagesDropped: number;
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
    | TurnStartEvent
    | TurnEndEvent
    | ToolCallEvent
    | AgentResponseEvent
    | ContextTransformEvent
    | ErrorEvent;
