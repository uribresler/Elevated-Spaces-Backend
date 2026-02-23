import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { addProjectPhotographer, createProject, getMyProjects, getProjectImages } from "../controllers/projects.controller";

const router = Router();

router.post("/", requireAuth, createProject);
router.get("/", requireAuth, getMyProjects);
router.get("/:projectId/images", requireAuth, getProjectImages);
router.post("/:id/photographers", requireAuth, addProjectPhotographer);

export default router;
