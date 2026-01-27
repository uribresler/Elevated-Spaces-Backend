
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthUser } from "../types/auth";
import { role } from "@prisma/client";


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
            ) as AuthUser;
            req.user = {
                id: payload.id,
                email: payload.email,
                role: payload.role as role,
            };
            console.log("[optionalAuth] Token verified, user attached:", req.user);
        } catch (e) {
            console.log("[optionalAuth] Invalid token, treating as guest.", e);
        }
    } else {
        console.log("[optionalAuth] No Authorization header, treating as guest.");
    }
    next();
}

export function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const authHeader = req.headers.authorization;
    console.log("Auth Header:", authHeader);
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
