import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthUser } from "../types/auth";
import { role } from "@prisma/client";

export function requireAuth(
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

    const token = authHeader.split(" ")[1];

    try {
        const payload = jwt.verify(
            token,
            process.env.JWT_SECRET!
        ) as AuthUser;

        // THIS IS WHERE USER IS ATTACHED
        req.user = {
            id: payload.id,
            email: payload.email,
            role: payload.role as role,
        };

        next();
    } catch {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }
}
