import { Request, Response } from 'express';
import { ZodError } from 'zod';
import { loginSchema, signupSchema } from '../utils/authSchemas';
import { loginService, signupService } from '../services/auth.service';

export async function signup(req: Request, res: Response) {
  try {
    const data = signupSchema.parse(req.body);
    const result = await signupService(data);
    return res.status(201).json(result);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Validation error', details: err.issues });
    }
    if (err && typeof err === 'object' && 'code' in err) {
      if ((err as any).code === 'USER_EXISTS') {
        return res.status(409).json({ error: 'User already exists' });
      }
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const data = loginSchema.parse(req.body);
    const result = await loginService(data);
    return res.status(200).json(result);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Validation error', details: err.issues });
    }
    if (err && typeof err === 'object' && 'code' in err) {
      if ((err as any).code === 'INVALID_CREDENTIALS') {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
