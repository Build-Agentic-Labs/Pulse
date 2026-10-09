export type AnnexUploadStatus = {
  annexId: string;
  phase: "saving" | "uploading" | "success" | "error";
  message: string;
};
