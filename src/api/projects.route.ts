import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { addProjectPhotographer, createProject, getMyProjects } from "../controllers/projects.controller";

const router = Router();

router.post("/", requireAuth, createProject);
router.get("/my", requireAuth, getMyProjects);
router.post("/:id/photographers", requireAuth, addProjectPhotographer);

export default router;
