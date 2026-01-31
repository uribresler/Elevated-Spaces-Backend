

import { user_role } from "@prisma/client";


export interface AuthUser {
  id: string;
  email: string;
  role?: user_role;
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