import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  listResourcesHandler,
  getResourceHandler,
  updateResourceHandler,
  getResourcePdfHandler,
  getResourceVideoHandler,
} from "../controllers/resource.controller";
import { uploadResourceFiles } from "../middlewares/uploadResource";

const router = Router();

router.get("/", listResourcesHandler);
router.get("/:slug", getResourceHandler);
router.get("/:slug/pdf", getResourcePdfHandler);
router.get("/:slug/video", getResourceVideoHandler);
router.put("/:slug", requireAuth, uploadResourceFiles, updateResourceHandler);

export default router;
