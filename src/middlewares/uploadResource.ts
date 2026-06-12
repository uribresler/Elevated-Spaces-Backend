import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB max
  },
});

export const uploadResourceFiles = upload.fields([
  { name: "pdf", maxCount: 1 },
]);

export default uploadResourceFiles;
