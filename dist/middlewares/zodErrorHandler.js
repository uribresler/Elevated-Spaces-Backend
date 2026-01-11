"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exampleSchema = void 0;
exports.zodErrorHandler = zodErrorHandler;
const zod_1 = require("zod");
// Example Zod schema for demonstration
exports.exampleSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
});
// Zod error handler middleware
function zodErrorHandler(err, req, res, next) {
    if (err instanceof zod_1.ZodError) {
        return res.status(400).json({
            error: 'Validation Error',
            details: err.issues,
        });
    }
    next(err);
}
