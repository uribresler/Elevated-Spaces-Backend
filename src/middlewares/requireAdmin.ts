import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
    });
  }

  // Check if user has admin role
  const userRoles = (req.user as any).role || [];
  const isAdmin = Array.isArray(userRoles) 
    ? userRoles.includes('ADMIN') 
    : userRoles === 'ADMIN';

  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
    });
  }

  next();
}
