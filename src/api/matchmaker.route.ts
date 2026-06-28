import { Router } from "express";
import { matchmakerSearch } from "../controllers/matchmaker.controller";

const router = Router();

router.post("/search", matchmakerSearch);

export default router;
