import prisma from '../dbConnection';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

export async function signupService({ email, password, name }: { email: string; password: string; name?: string }) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err: any = new Error('User already exists');
    err.code = 'USER_EXISTS';
    throw err;
  }
  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password_hash: hash, name, role: 'USER' },
  });
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

export async function loginService({ email, password }: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const err: any = new Error('Invalid credentials');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const err: any = new Error('Invalid credentials');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
}
