export interface paths {
    "/v1/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getLiveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ApiError: {
            code: string;
            correlationId: string;
            message: string;
        };
        LivenessResponse: {
            /** @constant */
            status: "ok";
        };
        ReadinessResponse: {
            dependencies: {
                /** @enum {string} */
                ephemeralRedis: "up" | "down";
                /** @enum {string} */
                postgres: "up" | "down";
                /** @enum {string} */
                queueRedis: "up" | "down";
            };
            /** @enum {string} */
            status: "ready" | "unavailable";
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getLiveness: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Process is alive */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LivenessResponse"];
                };
            };
            /** @description No operation matches the requested path and method. The body is an ApiError with code HTTP_404. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getReadiness: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dependencies are ready */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadinessResponse"];
                };
            };
            /** @description No operation matches the requested path and method. The body is an ApiError with code HTTP_404. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A required dependency is unavailable */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadinessResponse"];
                };
            };
        };
    };
}

