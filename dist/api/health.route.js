"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const health_controller_1 = require("../controllers/health.controller");
const rbac_1 = require("../middlewares/rbac");
const router = (0, express_1.Router)();
router.get('/health', (0, rbac_1.authorizeRoles)('admin', 'user', 'photographer'), health_controller_1.healthCheck);
exports.default = router;
