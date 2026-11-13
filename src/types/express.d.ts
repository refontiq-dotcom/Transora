declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      role: string;
      tenantId: string;
    }

    interface Request {
      user?: User;
      tenantId?: string;
    }
  }
}

export {};
