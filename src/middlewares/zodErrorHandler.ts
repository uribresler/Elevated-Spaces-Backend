import { z, ZodError } from 'zod';
import { Request, Response, NextFunction } from 'express';

// Example Zod schema for demonstration
export const exampleSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Zod error handler middleware
export function zodErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.issues,
    });
  }
  next(err);
}
