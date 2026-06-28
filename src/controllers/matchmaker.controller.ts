import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { searchPhotographersByPrompt } from "../services/matchmaker.service";

export async function matchmakerSearch(req: Request, res: Response): Promise<void> {
  try {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    if (!prompt.trim()) {
      res.status(400).json({ success: false, message: "Prompt is required" });
      return;
    }
    if (prompt.length > 1000) {
      res.status(400).json({ success: false, message: "Prompt is too long (max 1000 chars)" });
      return;
    }

    const result = await searchPhotographersByPrompt(prompt);
    res.status(200).json({
      success: true,
      data: {
        filters: result.filters,
        partialMatch: result.partialMatch,
        total: result.photographers.length,
        photographers: result.photographers,
      },
    });
  } catch (error) {
    logger(`[MATCHMAKER] search failed: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ success: false, message: "Matchmaker search failed" });
  }
}
