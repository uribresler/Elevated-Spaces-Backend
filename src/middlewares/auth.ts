
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthUser } from "../types/auth";
import prisma from "../dbConnection";


// Optional authentication middleware: sets req.user if token is present and valid, otherwise allows guest
export function optionalAuth(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        try {
            const payload = jwt.verify(
                token,
                process.env.JWT_SECRET!
            ) as any;
            req.user = {
                id: payload.userId || payload.id,
                email: payload.email,
                role: payload.role,
            };
        } catch {
        }
    }
    next();
}

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

    const token = authHeader?.split(" ")[1];

    let payload: any;
    try {
        payload = jwt.verify(
            token,
            process.env.JWT_SECRET!
        ) as any;
    } catch {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    const userId = payload.userId || payload.id;

    try {
        const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, deletion_requested_at: true } as any,
        });
        if (!dbUser) {
            return res.status(401).json({ success: false, message: "Account not found" });
        }
        if ((dbUser as any).deletion_requested_at) {
            return res.status(403).json({
                success: false,
                code: "ACCOUNT_PENDING_DELETION",
                message: "Account scheduled for deletion. Contact support to revert before the grace period ends.",
            });
        }
    } catch {
        // if DB check fails for transient reasons, proceed with token-only auth
    }

    req.user = {
        id: userId,
        email: payload.email,
        role: payload.role,
    };

    next();
}
