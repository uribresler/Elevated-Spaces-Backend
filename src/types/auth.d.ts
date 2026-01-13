import { role } from "@prisma/client";

export interface AuthUser {
    id: string;
    email: string;
    role?: role;
}


export interface OAuthResult {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    avatarUrl: string | null;
    authProvider: string;
  };
  success: boolean;
  isNewUser: boolean;
}