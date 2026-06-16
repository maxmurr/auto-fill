/** A browser File counts as a PDF upload by MIME type or `.pdf` extension. */
export function isPdfUpload(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}
