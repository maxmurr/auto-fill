import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // mupdf ships a .wasm + top-level-await ESM that must not be bundled by Next;
  // keep it external so it's required at runtime from node_modules.
  serverExternalPackages: ["mupdf"],
};

export default withWorkflow(nextConfig);
