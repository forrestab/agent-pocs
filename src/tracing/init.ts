import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { trace } from "@opentelemetry/api";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

let sdkStarted = false;

export function initTracing(): void {
    if (sdkStarted) {
        return;
    }

    const exporterUrl = Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? `${Bun.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
        : "http://localhost:4318/v1/traces";

    const sdk = new NodeSDK({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: Bun.env.OTEL_SERVICE_NAME ?? "homelab-agent",
            [ATTR_SERVICE_VERSION]: "0.1.0",
            "deployment.environment": Bun.env.NODE_ENV ?? "development",
        }),
        traceExporter: new OTLPTraceExporter({
            url: exporterUrl,
        }),
    });

    sdk.start();
    sdkStarted = true;

    const shutdown = async () => {
        try {
            await sdk.shutdown();
        } catch (error) {
            console.error("[tracing] shutdown error:", error);
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
