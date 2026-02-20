declare global {
  namespace Express {
    interface Request {
      authUid?: string;
    }
  }
}

export {};
