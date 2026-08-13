export const correlationHeader = 'x-correlation-id';

export type SafeTelemetryValue = boolean | number | string;
export type SafeTelemetryAttributes = Readonly<
  Record<string, SafeTelemetryValue | undefined>
>;
