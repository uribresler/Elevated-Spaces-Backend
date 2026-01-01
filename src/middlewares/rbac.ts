import { Request, Response, NextFunction } from 'express';

// Roles: 'user', 'photographer', 'admin'
export function authorizeRoles(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Assume req.user is set by authentication middleware
    const user = (req as any).user;
    if (!user || !user.role) {
      return res.status(401).json({ error: 'Unauthorized: No user or role found' });
    }
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient role' });
    }
    next();
  };
}
