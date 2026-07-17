export class OraculoPipelineCancelledError extends Error {
  constructor(message = "Cancelamento solicitado pelo usuário.") {
    super(message);
    this.name = "OraculoPipelineCancelledError";
  }
}

export function isOraculoPipelineCancelledError(
  error: unknown,
): error is OraculoPipelineCancelledError {
  return (
    error instanceof OraculoPipelineCancelledError ||
    (error instanceof Error && error.name === "OraculoPipelineCancelledError")
  );
}
