export interface CheckOutcome {
  status: "up" | "down";
  responseTimeMs: number | null;
  httpStatus: number | null;
  errorMessage: string | null;
}
