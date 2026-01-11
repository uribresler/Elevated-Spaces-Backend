"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRoles = authorizeRoles;
// Roles: 'user', 'photographer', 'admin'
function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        // Assume req.user is set by authentication middleware
        const user = req.user;
        if (!user || !user.role) {
            return res.status(401).json({ error: 'Unauthorized: No user or role found' });
        }
        if (!allowedRoles.includes(user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient role' });
        }
        next();
    };
}
